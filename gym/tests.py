from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse
from .models import AccessTicket, Entry, LoginAttempt, Member, StatusEvent, Terminal
from .access import consume_ticket, current_ticket
from datetime import timedelta
from django.utils import timezone
from django.test import override_settings
from django.db import IntegrityError, transaction


class AccessFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser('admin', 'admin@example.com', 'Different!Admin763')
        cls.student = User.objects.create_user('ana', 'ana@example.com', 'Different!Student763', first_name='Ana')
        cls.member = Member.objects.create(user=cls.student)

    def test_signup_confirms_and_cannot_choose_role_or_status(self):
        response = self.client.post(reverse('signup'), {
            'first_name': 'Bruno', 'email': 'bruno@example.com', 'username': 'bruno',
            'password1': '1234', 'password2': '1234',
            'role': 'employee', 'status': 'approved', 'is_superuser': 'true',
        }, follow=True)
        self.assertContains(response, 'Tudo certo, Bruno!')
        member = Member.objects.get(user__first_name='Bruno')
        self.assertEqual(member.status, Member.Status.PENDING)
        self.assertEqual(member.role, Member.Role.STUDENT)
        self.assertFalse(member.user.is_superuser)
        self.assertTrue(member.user.check_password('1234'))

    def test_login_and_pending_dashboard(self):
        response = self.client.post(reverse('login'), {'username': 'ana', 'password': 'Different!Student763'}, follow=True)
        self.assertContains(response, 'Aguardando aprovação')

    def test_non_admin_cannot_manage_or_approve(self):
        self.client.force_login(self.student)
        self.assertEqual(self.client.get(reverse('management')).status_code, 403)
        self.assertEqual(self.client.post(reverse('change_status', args=[self.member.pk, 'approve']), {'confirmed': 'yes'}).status_code, 403)
        self.assertEqual(self.client.get(reverse('create_member')).status_code, 403)

    def test_pending_and_blocked_cannot_check_in(self):
        self.client.force_login(self.student)
        for status in [Member.Status.PENDING, Member.Status.BLOCKED, Member.Status.REJECTED]:
            self.member.status = status
            self.member.save()
            self.client.post(reverse('check_in'))
        self.assertEqual(Entry.objects.count(), 0)

    def test_approval_requires_confirmation_and_allows_one_daily_entry(self):
        self.client.force_login(self.admin)
        url = reverse('change_status', args=[self.member.pk, 'approve'])
        self.assertEqual(self.client.get(url).status_code, 405)
        self.assertContains(self.client.post(url), 'Confirmar alteração')
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, Member.Status.PENDING)
        self.client.post(url, {'confirmed': 'yes'})
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, Member.Status.APPROVED)
        self.assertEqual(StatusEvent.objects.get().actor, self.admin)
        terminal = Terminal.objects.create(owner=self.admin)
        consume_ticket(current_ticket(terminal).pk, self.student)
        consume_ticket(current_ticket(terminal).pk, self.student)
        self.assertEqual(Entry.objects.count(), 1)

    def test_admin_creates_employee_without_admin_privileges(self):
        self.client.force_login(self.admin)
        response = self.client.post(reverse('create_member'), {
            'first_name': 'Carla', 'email': 'carla@example.com', 'username': 'carla',
            'password1': '4321', 'password2': '4321', 'role': 'employee',
        }, follow=True)
        self.assertContains(response, 'Cadastro criado e aprovado')
        member = Member.objects.get(user__first_name='Carla')
        self.assertEqual(member.role, Member.Role.EMPLOYEE)
        self.assertEqual(member.status, Member.Status.APPROVED)
        self.client.force_login(member.user)
        self.assertEqual(self.client.get(reverse('management')).status_code, 403)

    def test_users_only_see_their_own_history(self):
        other = User.objects.create_user('other', first_name='Pessoa Privada')
        other_member = Member.objects.create(user=other, status='approved')
        Entry.objects.create(member=other_member)
        self.client.force_login(self.student)
        response = self.client.get(reverse('dashboard'))
        self.assertNotContains(response, 'Pessoa Privada')
        self.assertContains(response, 'Seu histórico começa aqui')

    def test_csrf_is_required(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.admin)
        response = client.post(reverse('change_status', args=[self.member.pk, 'approve']), {'confirmed': 'yes'})
        self.assertEqual(response.status_code, 403)

    def test_health_and_public_pages(self):
        for page in ['home', 'login', 'signup']:
            self.assertEqual(self.client.get(reverse(page)).status_code, 200)
        self.assertEqual(self.client.get(reverse('health')).json()['status'], 'ok')

    def test_search_and_status_filter(self):
        self.client.force_login(self.admin)
        response = self.client.get(reverse('management'), {'q': 'Ana', 'status': 'pending'})
        self.assertContains(response, f'ID {self.member.access_id}')
        response = self.client.get(reverse('management'), {'q': 'inexistente'})
        self.assertContains(response, 'Nenhuma pessoa encontrada')

    def test_block_requires_reason_and_preserves_audit_on_unblock(self):
        self.member.status = Member.Status.APPROVED
        self.member.save()
        self.client.force_login(self.admin)
        url = reverse('change_status', args=[self.member.pk, 'block'])
        response = self.client.post(url, {'confirmed': 'yes'})
        self.assertContains(response, 'Este campo é obrigatório')
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, Member.Status.APPROVED)
        response = self.client.post(url, {'confirmed': 'yes', 'reason': 'overdue', 'notes': 'Contato interno em 03/11'}, follow=True)
        self.assertContains(response, 'Pagamento atrasado')
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, Member.Status.BLOCKED)
        self.assertEqual(self.member.block_reason, 'overdue')
        self.client.force_login(self.student)
        response = self.client.get(reverse('dashboard'))
        self.assertContains(response, 'Pagamento atrasado')
        self.assertNotContains(response, 'Contato interno')
        self.client.post(reverse('check_in'))
        self.assertEqual(Entry.objects.count(), 0)
        self.client.force_login(self.admin)
        self.client.post(reverse('change_status', args=[self.member.pk, 'approve']), {'confirmed': 'yes'})
        self.member.refresh_from_db()
        self.assertEqual(self.member.block_reason, '')
        self.assertEqual(self.member.block_notes, '')
        event = StatusEvent.objects.get(status='blocked')
        self.assertEqual(event.reason, 'overdue')
        self.assertEqual(event.notes, 'Contato interno em 03/11')

    def test_invalid_block_reason_is_rejected(self):
        self.client.force_login(self.admin)
        self.client.post(reverse('change_status', args=[self.member.pk, 'block']), {'confirmed': 'yes', 'reason': 'invalid'})
        self.member.refresh_from_db()
        self.assertEqual(self.member.status, Member.Status.PENDING)
        self.assertFalse(StatusEvent.objects.exists())

    def test_filter_blocked_by_reason(self):
        self.member.status = 'blocked'
        self.member.block_reason = 'unpaid'
        self.member.save()
        self.client.force_login(self.admin)
        self.assertContains(self.client.get(reverse('management'), {'reason': 'unpaid'}), f'ID {self.member.access_id}')
        self.assertNotContains(self.client.get(reverse('management'), {'reason': 'overdue'}), f'ID {self.member.access_id}')

    def test_entry_proposal_is_admin_only(self):
        self.client.force_login(self.student)
        self.assertEqual(self.client.get(reverse('entry_plan')).status_code, 403)
        self.client.force_login(self.admin)
        self.assertContains(self.client.get(reverse('entry_plan')), 'Sem catraca')


class PinAndQRTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser('admin', '', 'Administrator!763')
        self.user = User.objects.create_user('internal-random-user', first_name='Aluno QR', password='1234')
        self.member = Member.objects.create(user=self.user, status='approved')
        self.terminal = Terminal.objects.create(owner=self.admin)

    def ticket(self):
        return current_ticket(self.terminal)

    def test_pin_is_hashed_and_login_accepts_generated_id(self):
        response = self.client.post(reverse('login'), {'username': self.member.access_id, 'password': '1234'}, follow=True)
        self.assertContains(response, 'Dias em que fui à academia')
        self.assertContains(response, 'Pago')
        self.assertNotEqual(self.user.password, '1234')
        self.assertTrue(self.user.check_password('1234'))

    def test_pin_rejects_letters_short_spaces_and_unicode(self):
        from .forms import SignupForm
        for pin in ['123', 'abc1234', '12 34', '１２３４', '1234 ', '1' * 33]:
            form = SignupForm({'first_name': 'Teste', 'email': 'test@example.com', 'password1': pin, 'password2': pin})
            self.assertFalse(form.is_valid(), pin)
        form = SignupForm({'first_name': 'Teste', 'email': 'test@example.com', 'password1': '0000', 'password2': '0000'})
        self.assertTrue(form.is_valid(), form.errors)

    def test_pin_confirmation_must_match(self):
        response = self.client.post(reverse('signup'), {'first_name': 'Teste', 'email': 'test@example.com', 'password1': '1234', 'password2': '4321'})
        self.assertContains(response, 'Os PINs precisam ser iguais')
        self.assertEqual(Member.objects.count(), 1)

    def test_signup_displays_id_and_ignores_requested_username(self):
        response = self.client.post(reverse('signup'), {'first_name': 'Novo', 'email': 'novo@example.com', 'username': 'admin', 'password1': '1234', 'password2': '1234'}, follow=True)
        member = Member.objects.get(user__first_name='Novo')
        self.assertContains(response, member.access_id)
        self.assertNotEqual(member.access_id, self.member.access_id)
        self.assertNotEqual(member.user.username, 'admin')

    def test_admin_can_reset_existing_member_pin(self):
        self.client.force_login(self.admin)
        self.client.post(reverse('reset_pin', args=[self.member.pk]), {'password1': '9876', 'password2': '9876'})
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('9876'))
        self.assertFalse(self.user.check_password('1234'))
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(reverse('reset_pin', args=[self.member.pk])).status_code, 403)

    def test_failed_pin_attempts_are_limited_for_padded_ids(self):
        for _ in range(5):
            self.client.post(reverse('login'), {'username': self.member.access_id, 'password': '9999'})
        response = self.client.post(reverse('login'), {'username': str(self.member.pk), 'password': '1234'})
        self.assertContains(response, 'Aguarde 5 minutos')
        LoginAttempt.objects.update(window_started=timezone.now() - timedelta(minutes=6))
        self.assertEqual(self.client.post(reverse('login'), {'username': self.member.access_id, 'password': '1234'}).status_code, 302)

    def test_scan_get_does_not_register_entry(self):
        ticket = self.ticket()
        self.assertContains(self.client.get(reverse('mobile_access', args=[ticket.pk])), 'Seu ID')
        self.client.force_login(self.user)
        self.client.get(reverse('mobile_access', args=[ticket.pk]))
        ticket.refresh_from_db()
        self.assertIsNone(ticket.consumed_at)
        self.assertFalse(Entry.objects.exists())

    def test_phone_login_updates_the_computer_and_daily_history(self):
        computer = Client()
        computer.force_login(self.admin)
        phone = Client()
        ticket = self.ticket()
        response = phone.post(reverse('mobile_access', args=[ticket.pk]), {'username': self.member.access_id, 'password': '1234'}, follow=True)
        self.assertContains(response, 'Acesso liberado!')
        state = computer.get(reverse('kiosk_state', args=[self.terminal.pk])).json()
        self.assertEqual(state['decision'], 'granted')
        self.assertEqual(Entry.objects.get().member, self.member)
        self.assertContains(phone.get(reverse('dashboard')), timezone.localdate().strftime('%d/%m/%Y'))
        response = phone.post(reverse('mobile_access', args=[ticket.pk]))
        self.assertEqual(Entry.objects.count(), 1)
        consume_ticket(current_ticket(self.terminal).pk, self.user)
        self.assertEqual(Entry.objects.count(), 1)

    def test_block_after_qr_generation_is_checked_at_entry(self):
        ticket = self.ticket()
        self.member.status = 'blocked'
        self.member.block_reason = 'overdue'
        self.member.save()
        self.client.force_login(self.user)
        response = self.client.post(reverse('mobile_access', args=[ticket.pk]), follow=True)
        self.assertContains(response, 'Acesso bloqueado')
        self.assertFalse(Entry.objects.exists())
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get(reverse('kiosk_state', args=[self.terminal.pk])).json()['decision'], 'denied')

    def test_expired_qr_is_rejected_and_new_qr_generated(self):
        ticket = self.ticket()
        AccessTicket.objects.filter(pk=ticket.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.client.force_login(self.user)
        response = self.client.post(reverse('mobile_access', args=[ticket.pk]))
        self.assertContains(response, 'venceu ou já foi utilizado')
        self.assertFalse(Entry.objects.exists())
        self.assertNotEqual(self.ticket().pk, ticket.pk)

    def test_token_cannot_be_consumed_twice_by_another_student(self):
        ticket = self.ticket()
        consume_ticket(ticket.pk, self.user)
        other = User.objects.create_user('other-member', password='4321')
        Member.objects.create(user=other, status='approved')
        self.assertIsNone(consume_ticket(ticket.pk, other))
        self.assertEqual(Entry.objects.count(), 1)
        self.client.force_login(other)
        self.assertContains(self.client.get(reverse('mobile_access', args=[ticket.pk])), 'venceu ou já foi utilizado')

    @override_settings(PUBLIC_BASE_URL='http://192.168.18.103:8000')
    def test_qr_uses_network_address_even_when_computer_uses_localhost(self):
        self.client.force_login(self.admin)
        state = self.client.get(reverse('kiosk_state', args=[self.terminal.pk])).json()
        self.assertTrue(state['mobile_url'].startswith('http://192.168.18.103:8000/acesso/'))
        svg = self.client.get(state['qr'])
        self.assertEqual(svg.status_code, 200)
        self.assertEqual(svg['Content-Type'], 'image/svg+xml')
        self.assertIn(b'<svg', svg.content)
        self.assertIn('no-store', svg['Cache-Control'])

    def test_kiosk_is_admin_only_and_terminals_are_isolated(self):
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(reverse('kiosk')).status_code, 403)
        self.assertEqual(self.client.get(reverse('kiosk_state', args=[self.terminal.pk])).status_code, 403)
        other_admin = User.objects.create_superuser('other-admin', '', 'Administrator!763')
        self.client.force_login(other_admin)
        self.assertEqual(self.client.get(reverse('kiosk_state', args=[self.terminal.pk])).status_code, 404)
        self.assertEqual(self.client.get(reverse('kiosk_qr', args=[self.ticket().pk])).status_code, 404)
        self.assertContains(self.client.get(reverse('kiosk')), 'Aguardando leitura')

    def test_old_button_no_longer_records_remote_entry(self):
        self.client.force_login(self.user)
        self.client.post(reverse('check_in'))
        self.assertFalse(Entry.objects.exists())

    def test_entry_requires_csrf_and_day_is_unique_in_database(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        response = client.post(reverse('mobile_access', args=[self.ticket().pk]))
        self.assertEqual(response.status_code, 403)
        Entry.objects.create(member=self.member)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Entry.objects.create(member=self.member)
