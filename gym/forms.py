import hashlib
import re
import uuid
from datetime import timedelta
from django import forms
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from .models import LoginAttempt, Member


class LoginForm(AuthenticationForm):
    username = forms.CharField(label='ID do aluno ou usuário administrador', max_length=150,
        widget=forms.TextInput(attrs={'autocomplete': 'username', 'placeholder': 'Ex.: 000001'}))
    password = forms.CharField(label='PIN / senha', strip=False,
        widget=forms.PasswordInput(attrs={'autocomplete': 'current-password'}))

    def clean(self):
        # Limite persistente por identificador: 5 erros em uma janela de 5 minutos.
        value = str(self.cleaned_data.get('username', '')).strip().lower()
        if value.isascii() and value.isdigit():
            value = str(int(value))
        if not value or not self.cleaned_data.get('password'):
            return super().clean()
        key = hashlib.sha256(value.encode()).hexdigest()
        with transaction.atomic():
            attempt, _ = LoginAttempt.objects.get_or_create(key=key)
            if attempt.window_started < timezone.now() - timedelta(minutes=5):
                attempt.failures = 0
                attempt.window_started = timezone.now()
                attempt.save()
            if attempt.failures >= 5:
                raise ValidationError('Muitas tentativas. Aguarde 5 minutos e tente novamente.')
        try:
            result = super().clean()
        except ValidationError:
            from django.db.models import F
            LoginAttempt.objects.filter(key=key).update(failures=F('failures') + 1)
            raise
        LoginAttempt.objects.filter(key=key).delete()
        return result


class SignupForm(forms.Form):
    first_name = forms.CharField(label='Nome completo', max_length=150)
    email = forms.EmailField(label='E-mail')
    password1 = forms.CharField(label='Crie seu PIN', strip=False, max_length=32,
        help_text='Use de 4 a 32 números. Seu ID será gerado automaticamente.',
        widget=forms.PasswordInput(attrs={'inputmode': 'numeric', 'pattern': '[0-9]{4,32}', 'minlength': 4, 'maxlength': 32, 'autocomplete': 'new-password'}))
    password2 = forms.CharField(label='Repita o PIN', strip=False, max_length=32,
        widget=forms.PasswordInput(attrs={'inputmode': 'numeric', 'pattern': '[0-9]{4,32}', 'minlength': 4, 'maxlength': 32, 'autocomplete': 'new-password'}))

    def clean_password1(self):
        value = self.cleaned_data['password1']
        if not re.fullmatch(r'[0-9]{4,32}', value):
            raise ValidationError('O PIN deve ter de 4 a 32 números, sem letras ou espaços.')
        return value

    def clean(self):
        data = super().clean()
        if data.get('password1') and data.get('password2') != data['password1']:
            self.add_error('password2', 'Os PINs precisam ser iguais.')
        return data

    def save(self):
        # O PIN continua armazenado como hash pelo Django, nunca em texto puro.
        return User.objects.create_user(
            username='member_' + uuid.uuid4().hex,
            first_name=self.cleaned_data['first_name'], email=self.cleaned_data['email'],
            password=self.cleaned_data['password1'],
        )


class AdminMemberForm(SignupForm):
    role = forms.ChoiceField(label='Tipo de cadastro', choices=Member.Role.choices)


class PinResetForm(SignupForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields.pop('first_name')
        self.fields.pop('email')

    def save_for(self, user):
        user.set_password(self.cleaned_data['password1'])
        user.save(update_fields=['password'])


class BlockForm(forms.Form):
    reason = forms.ChoiceField(label='Motivo do bloqueio', choices=[('', 'Selecione um motivo')] + list(Member.BlockReason.choices))
    notes = forms.CharField(label='Observação interna (opcional)', max_length=500, required=False,
                           widget=forms.Textarea(attrs={'rows': 3}),
                           help_text='Visível apenas ao administrador. O aluno vê somente o motivo selecionado.')
