from io import BytesIO
from django.conf import settings
from django.contrib.auth import login
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.cache import never_cache
import qrcode
import qrcode.image.svg
from .access import consume_ticket, current_ticket
from .forms import LoginForm
from .models import AccessTicket, Member, Terminal
from .views import admin_required


@admin_required
@never_cache
def kiosk(request):
    terminal = Terminal.objects.filter(owner=request.user, id=request.session.get('terminal_id')).first() if request.session.get('terminal_id') else None
    if terminal is None:
        terminal = Terminal.objects.create(owner=request.user)
    request.session['terminal_id'] = str(terminal.pk)
    return render(request, 'kiosk.html', {'terminal': terminal, 'kiosk_mode': True})


@admin_required
@never_cache
def kiosk_state(request, terminal_id):
    terminal = get_object_or_404(Terminal, pk=terminal_id, owner=request.user)
    ticket = current_ticket(terminal)
    last = terminal.tickets.filter(consumed_at__isnull=False).order_by('-consumed_at').first()
    decision = last.decision if last and (timezone.now() - last.consumed_at).total_seconds() <= 8 else ''
    return JsonResponse({
        'qr': reverse('kiosk_qr', args=[ticket.pk]),
        'expires_at': ticket.expires_at.isoformat(),
        'decision': decision,
        'mobile_url': mobile_url(request, ticket),
    })


def mobile_url(request, ticket):
    path = reverse('mobile_access', args=[ticket.pk])
    return settings.PUBLIC_BASE_URL + path if settings.PUBLIC_BASE_URL else request.build_absolute_uri(path)


@admin_required
@never_cache
def kiosk_qr(request, ticket_id):
    ticket = get_object_or_404(AccessTicket, pk=ticket_id, terminal__owner=request.user)
    if ticket.consumed_at or ticket.expires_at <= timezone.now():
        return HttpResponse(status=410)
    image = qrcode.make(mobile_url(request, ticket), image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=4)
    output = BytesIO()
    image.save(output)
    return HttpResponse(output.getvalue(), content_type='image/svg+xml')


@never_cache
def mobile_access(request, ticket_id):
    ticket = get_object_or_404(AccessTicket, pk=ticket_id)
    if ticket.consumed_at:
        if request.user.is_authenticated and ticket.member_id and ticket.member.user_id == request.user.pk:
            return render(request, 'mobile_access.html', {'result': ticket.decision})
        return render(request, 'mobile_access.html', {'expired': True})
    if ticket.expires_at <= timezone.now():
        return render(request, 'mobile_access.html', {'expired': True})
    form = None
    if not request.user.is_authenticated:
        form = LoginForm(request, data=request.POST or None)
        form.fields['username'].label = 'Seu ID'
        form.fields['username'].widget.attrs['inputmode'] = 'numeric'
        form.fields['password'].label = 'Seu PIN'
        form.fields['password'].widget.attrs['inputmode'] = 'numeric'
    if request.method == 'POST':
        if form is not None and form.is_valid():
            login(request, form.get_user())
        if request.user.is_authenticated:
            if not Member.objects.filter(user=request.user).exists():
                return render(request, 'mobile_access.html', {'admin_account': True})
            result = consume_ticket(ticket.pk, request.user)
            if result is None:
                return render(request, 'mobile_access.html', {'expired': True})
            return redirect('mobile_access', ticket_id=ticket.pk)
    return render(request, 'mobile_access.html', {'form': form, 'admin_account': request.user.is_authenticated and request.user.is_superuser})
