from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name='Member', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('role', models.CharField(choices=[('student', 'Aluno'), ('employee', 'Funcionário')], default='student', max_length=12)),
            ('status', models.CharField(choices=[('pending', 'Aguardando aprovação'), ('approved', 'Aprovado'), ('blocked', 'Bloqueado'), ('rejected', 'Recusado')], default='pending', max_length=12)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
        ], options={'ordering': ['-created_at']}),
        migrations.CreateModel(name='Entry', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('member', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='entries', to='gym.member')),
        ], options={'ordering': ['-created_at']}),
        migrations.CreateModel(name='StatusEvent', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('status', models.CharField(choices=[('pending', 'Aguardando aprovação'), ('approved', 'Aprovado'), ('blocked', 'Bloqueado'), ('rejected', 'Recusado')], max_length=12)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('actor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ('member', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='gym.member')),
        ], options={'ordering': ['-created_at']}),
    ]
