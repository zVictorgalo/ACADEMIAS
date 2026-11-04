from django.contrib.auth.backends import ModelBackend
from .models import Member


class AccessBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        value = str(username or '').strip()
        if value.isascii() and value.isdigit():
            # A matrícula numérica referencia a chave do cadastro, estável e única.
            # O username interno não precisa ser informado pelo aluno.
            try:
                value = Member.objects.select_related('user').get(pk=int(value)).user.username
            except (Member.DoesNotExist, ValueError, OverflowError):
                value = '__unknown_member__'
        return super().authenticate(request, username=value, password=password, **kwargs)
