from functools import wraps
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.http import require_POST
from .forms import AdminMemberForm, BlockForm, LoginForm, PinResetForm, SignupForm
from .models import Entry, Member, StatusEvent


def admin_required(view):
    @login_required
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if not request.user.is_superuser:
            raise PermissionDenied
        return view(request, *args, **kwargs)
    return wrapper


class GymLoginView(LoginView):
    template_name = 'login.html'
    authentication_form = LoginForm
    redirect_authenticated_user = True


def home(request):
    return render(request, 'home.html')


def signup(request):
    if request.user.is_authenticated:
        return redirect('dashboard')
    form = SignupForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            user = form.save()
            member = Member.objects.create(user=user)
        request.session['signup_name'] = user.first_name
        request.session['signup_id'] = member.access_id
        return redirect('signup_done')
    return render(request, 'form.html', {'form': form, 'title': 'Seu primeiro passo começa aqui.', 'subtitle': 'Crie sua conta. A equipe da academia vai analisar seu cadastro.', 'button': 'Enviar cadastro'})


def signup_done(request):
    name = request.session.get('signup_name')
    if not name:
        return redirect('signup')
    return render(request, 'signup_done.html', {'name': name, 'access_id': request.session.get('signup_id')})


@login_required
def dashboard(request):
    if request.user.is_superuser:
        return redirect('management')
    member = get_object_or_404(Member, user=request.user)
    return render(request, 'dashboard.html', {'member': member, 'entries': member.entries.all()})


@admin_required
def management(request):
    members = Member.objects.select_related('user')
    query = request.GET.get('q', '').strip()
    status = request.GET.get('status', '')
    reason = request.GET.get('reason', '')
    if query:
        match = Q(user__first_name__icontains=query) | Q(user__username__icontains=query) | Q(user__email__icontains=query)
        if query.isascii() and query.isdigit() and len(query) < 19:
            match |= Q(pk=int(query))
        members = members.filter(match)
    if status in Member.Status.values:
        members = members.filter(status=status)
    if reason in Member.BlockReason.values:
        members = members.filter(status=Member.Status.BLOCKED, block_reason=reason)
    return render(request, 'management.html', {
        'members': members, 'query': query, 'selected_status': status,
        'statuses': Member.Status.choices,
        'reasons': Member.BlockReason.choices, 'selected_reason': reason,
        'blocked': Member.objects.filter(status=Member.Status.BLOCKED).count(),
        'total': Member.objects.count(),
        'pending': Member.objects.filter(status=Member.Status.PENDING).count(),
        'approved': Member.objects.filter(status=Member.Status.APPROVED).count(),
        'entries_today': Entry.objects.filter(created_at__date=timezone.localdate()).count(),
        'entries': Entry.objects.select_related('member__user')[:10],
        'events': StatusEvent.objects.select_related('member__user', 'actor')[:15],
    })


@admin_required
def create_member(request):
    form = AdminMemberForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        with transaction.atomic():
            user = form.save()
            member = Member.objects.create(user=user, role=form.cleaned_data['role'], status=Member.Status.APPROVED)
            StatusEvent.objects.create(member=member, actor=request.user, status=member.status)
        messages.success(request, f'Cadastro criado e aprovado. ID: {member.access_id}. Entregue esse ID e o PIN definido à pessoa cadastrada.')
        return redirect('management')
    return render(request, 'form.html', {'form': form, 'title': 'Uma nova pessoa no time.', 'subtitle': 'Cadastre um aluno ou funcionário com acesso aprovado.', 'button': 'Criar cadastro'})


@admin_required
@require_POST
def change_status(request, pk, action):
    transitions = {'approve': Member.Status.APPROVED, 'block': Member.Status.BLOCKED, 'reject': Member.Status.REJECTED}
    if action not in transitions:
        raise PermissionDenied
    member = get_object_or_404(Member, pk=pk)
    confirmed = request.POST.get('confirmed') == 'yes'
    form = BlockForm(request.POST if confirmed else None) if action == 'block' else None
    if not confirmed or (form is not None and not form.is_valid()):
        return render(request, 'confirm.html', {'member': member, 'action': action, 'block_form': form, 'new_status': Member.Status(transitions[action]).label})
    with transaction.atomic():
        member = get_object_or_404(Member, pk=pk)
        member.status = transitions[action]
        member.block_reason = form.cleaned_data['reason'] if form is not None else ''
        member.block_notes = form.cleaned_data['notes'] if form is not None else ''
        member.save(update_fields=['status', 'block_reason', 'block_notes'])
        StatusEvent.objects.create(member=member, actor=request.user, status=member.status,
                                   reason=member.block_reason, notes=member.block_notes)
    messages.success(request, f'Cadastro de {member.user.first_name}: {member.get_status_display()}.')
    return redirect('management')


@login_required
@require_POST
def check_in(request):
    # Não permite registrar presença remotamente apenas pelo botão antigo.
    messages.info(request, 'Para registrar sua entrada, leia o QR Code no painel da academia.')
    return redirect('dashboard')


def health(request):
    from django.db import connection
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1')
    return JsonResponse({'status': 'ok', 'version': 'id-pin-qr-v1'})


@admin_required
def entry_plan(request):
    return render(request, 'entry_plan.html')


@admin_required
def reset_pin(request, pk):
    member = get_object_or_404(Member.objects.select_related('user'), pk=pk)
    form = PinResetForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        form.save_for(member.user)
        messages.success(request, f'PIN do ID {member.access_id} atualizado. Informe o novo PIN ao aluno.')
        return redirect('management')
    return render(request, 'form.html', {'form': form, 'title': f'Novo PIN · ID {member.access_id}', 'subtitle': f'Defina um PIN numérico para {member.user.first_name}. O PIN anterior deixará de funcionar.', 'button': 'Salvar novo PIN'})
