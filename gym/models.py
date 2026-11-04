from django.conf import settings
from django.db import models
from django.utils import timezone
import uuid


class Member(models.Model):
    class BlockReason(models.TextChoices):
        UNPAID = 'unpaid', 'Falta de pagamento'
        OVERDUE = 'overdue', 'Pagamento atrasado'
        EXPIRED = 'expired', 'Cadastro vencido'
        REQUESTED = 'requested', 'Solicitação do usuário'
        OTHER = 'other', 'Outro motivo'

    class Role(models.TextChoices):
        STUDENT = 'student', 'Aluno'
        EMPLOYEE = 'employee', 'Funcionário'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Aguardando aprovação'
        APPROVED = 'approved', 'Aprovado'
        BLOCKED = 'blocked', 'Bloqueado'
        REJECTED = 'rejected', 'Recusado'

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=12, choices=Role.choices, default=Role.STUDENT)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    block_reason = models.CharField(max_length=20, choices=BlockReason.choices, blank=True)
    block_notes = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def access_id(self):
        return str(self.pk).zfill(6)

    @property
    def payment_label(self):
        # Situação manual: aprovar o cadastro equivale a marcar como pago neste MVP.
        if self.status == self.Status.APPROVED:
            return 'Pago'
        if self.status == self.Status.PENDING:
            return 'Aguardando aprovação'
        return 'Bloqueado'


class Entry(models.Model):
    member = models.ForeignKey(Member, on_delete=models.CASCADE, related_name='entries')
    created_at = models.DateTimeField(auto_now_add=True)
    day = models.DateField(default=timezone.localdate, null=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['member', 'day'], name='one_entry_per_member_day')]


class StatusEvent(models.Model):
    member = models.ForeignKey(Member, on_delete=models.CASCADE)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=12, choices=Member.Status.choices)
    reason = models.CharField(max_length=20, choices=Member.BlockReason.choices, blank=True)
    notes = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class LoginAttempt(models.Model):
    key = models.CharField(max_length=64, unique=True)
    failures = models.PositiveIntegerField(default=0)
    window_started = models.DateTimeField(default=timezone.now)


class Terminal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)


class AccessTicket(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    terminal = models.ForeignKey(Terminal, on_delete=models.CASCADE, related_name='tickets')
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    decision = models.CharField(max_length=12, blank=True)
    member = models.ForeignKey(Member, null=True, blank=True, on_delete=models.SET_NULL)
