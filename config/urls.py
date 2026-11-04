from django.urls import path
from django.contrib.auth.views import LogoutView
from gym import views
from gym import kiosk

urlpatterns = [
    path('', views.home, name='home'),
    path('entrar/', views.GymLoginView.as_view(), name='login'),
    path('sair/', LogoutView.as_view(), name='logout'),
    path('cadastro/', views.signup, name='signup'),
    path('cadastro/enviado/', views.signup_done, name='signup_done'),
    path('painel/', views.dashboard, name='dashboard'),
    path('gestao/', views.management, name='management'),
    path('gestao/proposta-entrada/', views.entry_plan, name='entry_plan'),
    path('gestao/novo/', views.create_member, name='create_member'),
    path('gestao/<int:pk>/pin/', views.reset_pin, name='reset_pin'),
    path('gestao/<int:pk>/<str:action>/', views.change_status, name='change_status'),
    path('entrada/', views.check_in, name='check_in'),
    path('portaria/', kiosk.kiosk, name='kiosk'),
    path('portaria/<uuid:terminal_id>/estado/', kiosk.kiosk_state, name='kiosk_state'),
    path('portaria/qr/<uuid:ticket_id>.svg', kiosk.kiosk_qr, name='kiosk_qr'),
    path('acesso/<uuid:ticket_id>/', kiosk.mobile_access, name='mobile_access'),
    path('health/', views.health, name='health'),
]
