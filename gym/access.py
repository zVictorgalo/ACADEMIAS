from datetime import timedelta
from django.db import transaction
from django.utils import timezone
from .models import AccessTicket, Entry, Member


def current_ticket(terminal):
    now = timezone.now()
    ticket = terminal.tickets.filter(consumed_at__isnull=True, expires_at__gt=now).order_by('-created_at').first()
    if ticket is None:
        ticket = AccessTicket.objects.create(terminal=terminal, expires_at=now + timedelta(minutes=3))
    return ticket


def consume_ticket(ticket_id, user):
    now = timezone.now()
    with transaction.atomic():
        # A atualização condicional é a primeira escrita: o QR só pode ser consumido uma vez.
        claimed = AccessTicket.objects.filter(pk=ticket_id, consumed_at__isnull=True, expires_at__gt=now).update(consumed_at=now)
        if not claimed:
            return None
        ticket = AccessTicket.objects.get(pk=ticket_id)
        member = Member.objects.select_related('user').get(user=user)
        ticket.member = member
        ticket.decision = 'granted' if member.status == Member.Status.APPROVED else 'denied'
        if ticket.decision == 'granted':
            Entry.objects.get_or_create(member=member, day=timezone.localdate())
        ticket.save(update_fields=['decision', 'member'])
        return ticket
