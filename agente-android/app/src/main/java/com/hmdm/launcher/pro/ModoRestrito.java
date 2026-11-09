package com.hmdm.launcher.pro;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.app.usage.UsageEvents;
import android.content.ComponentName;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import android.widget.Toast;

import com.hmdm.launcher.Const;
import com.hmdm.launcher.helper.SettingsHelper;
import com.hmdm.launcher.json.Application;
import com.hmdm.launcher.json.ServerConfig;
import com.hmdm.launcher.util.LegacyUtils;
import com.hmdm.launcher.util.Utils;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Customização MDM: modo restrito.
 *
 * Liga quando a política tem o campo "allowedClasses" preenchido (lista de telas das
 * Configurações do Android que o usuário pode abrir, separadas por vírgula). Com ele ligado:
 *
 * 1. Qualquer outra tela das Configurações (com.android.settings e a Central de segurança /
 *    permissões, no permissioncontroller) é fechada na hora e o
 *    usuário volta para a tela inicial do MDM. Assim dá para liberar só Wi-Fi e Tela, por
 *    exemplo, e o resto das Configurações fica fechado. O controle de brilho da barra de
 *    cima é do System UI, então continua funcionando.
 * 2. Todo app com ícone que não está na política é pausado (setPackagesSuspended, aplicado
 *    junto com os bloqueios por horário em BloqueioApps).
 * 3. O aparelho fica no modo quiosque do Android (lock task): a barra de cima mostra só as
 *    notificações, sem os botões rápidos.
 *
 * Para saber qual tela está aberta o agente precisa do "Acesso ao uso" (uma vez por aparelho):
 *   adb shell appops set com.hmdm.launcher GET_USAGE_STATS allow
 *
 * Formato das classes: nome completo ("com.android.settings.SubSettings"), nome começando
 * com ponto (".Settings$WifiSettingsActivity" = dentro de com.android.settings) ou prefixo
 * terminado em ".*" (".wifi.*").
 */
public class ModoRestrito {
    private static final String TAG = "ModoRestrito";
    private static final long INTERVALO_MS = 700;
    private static final long JANELA_INICIAL_MS = 5000;

    // Apps que mostram telas de configuração (a "Central de segurança" e as permissões não
    // ficam no com.android.settings)
    private static final Set<String> PACOTES_CONFIGURACOES = new HashSet<>(Arrays.asList(
            Const.SETTINGS_PACKAGE_NAME,
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller",
            // Notificação "Configuração do Android: toque para concluir" abre o assistente
            "com.google.android.setupwizard"));
    // Janelas em que um app pede permissão ou papel (ex.: app de telefone padrão): sem elas
    // os apps liberados não funcionam
    private static final Set<String> SEMPRE_PERMITIDAS = new HashSet<>(Arrays.asList(
            "com.android.permissioncontroller.permission.ui.GrantPermissionsActivity",
            "com.android.permissioncontroller.role.ui.RequestRoleActivity"));

    private static ScheduledExecutorService executor;
    private static long ultimaConsulta = 0;
    private static boolean avisouSemPermissao = false;
    private static Set<String> appsDoQuiosque = null;

    public static synchronized void iniciar(Context context) {
        if (executor != null) {
            return;
        }
        final Context appContext = context.getApplicationContext();
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(() -> {
            try {
                verificarTelaAberta(appContext);
            } catch (Throwable e) {
                Log.w(TAG, "Falha ao verificar a tela aberta", e);
            }
        }, 5000, INTERVALO_MS, TimeUnit.MILLISECONDS);
    }

    // Telas das Configurações liberadas pela política; null = modo restrito desligado
    private static Set<String> classesPermitidas(Context context) {
        ServerConfig config = SettingsHelper.getInstance(context).getConfig();
        if (config == null || config.getAllowedClasses() == null || config.getAllowedClasses().trim().isEmpty()) {
            return null;
        }
        Set<String> classes = new HashSet<>();
        for (String c : config.getAllowedClasses().split(",")) {
            c = c.trim();
            if (c.isEmpty()) {
                continue;
            }
            classes.add(c.startsWith(".") ? Const.SETTINGS_PACKAGE_NAME + c : c);
        }
        return classes;
    }

    public static boolean ativo(Context context) {
        return classesPermitidas(context) != null;
    }

    // Modo quiosque do Android (lock task), chamado quando a tela inicial do MDM aparece.
    // Nele, ao puxar a barra de cima aparecem só as notificações: os botões rápidos (Wi-Fi,
    // lanterna, engrenagem etc.) somem. Os apps continuam abrindo normalmente, porque todos os
    // instalados ficam na lista do quiosque (os de fora da política já estão pausados).
    public static void atualizarQuiosque(Activity activity) {
        if (!Utils.isDeviceOwner(activity) || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return;
        }
        DevicePolicyManager dpm = (DevicePolicyManager) activity.getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = LegacyUtils.getAdminComponentName(activity);
        ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
        boolean emQuiosque = am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        try {
            if (ativo(activity)) {
                atualizarAppsDoQuiosque(activity);
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_HOME
                        | DevicePolicyManager.LOCK_TASK_FEATURE_OVERVIEW
                        | DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS
                        | DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
                        | DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
                        | DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD);
                if (!emQuiosque) {
                    activity.startLockTask();
                    Log.i(TAG, "Modo quiosque ligado");
                }
            } else if (emQuiosque) {
                activity.stopLockTask();
                dpm.setLockTaskPackages(admin, new String[0]);
                appsDoQuiosque = null;
                Log.i(TAG, "Modo quiosque desligado");
            }
        } catch (Exception e) {
            Log.w(TAG, "Falha no modo quiosque: " + e.getMessage());
        }
    }

    // Lista de apps que podem abrir no quiosque = todos os instalados. Chamado também a cada
    // minuto (BloqueioApps), para incluir apps instalados depois.
    public static synchronized void atualizarAppsDoQuiosque(Context context) {
        if (!ativo(context) || !Utils.isDeviceOwner(context)) {
            return;
        }
        Set<String> instalados = new TreeSet<>();
        for (PackageInfo p : context.getPackageManager().getInstalledPackages(0)) {
            instalados.add(p.packageName);
        }
        if (instalados.equals(appsDoQuiosque)) {
            return;
        }
        DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        dpm.setLockTaskPackages(LegacyUtils.getAdminComponentName(context), instalados.toArray(new String[0]));
        appsDoQuiosque = instalados;
    }

    // Apps com ícone que não estão na política (os que BloqueioApps deve pausar)
    public static Set<String> appsForaDaPolitica(Context context) {
        Set<String> fora = new HashSet<>();
        if (!ativo(context)) {
            return fora;
        }
        ServerConfig config = SettingsHelper.getInstance(context).getConfig();
        Set<String> naPolitica = new HashSet<>();
        if (config.getApplications() != null) {
            for (Application app : config.getApplications()) {
                if (app.getPkg() != null && !app.isRemove()) {
                    naPolitica.add(app.getPkg());
                }
            }
        }
        PackageManager pm = context.getPackageManager();
        Intent principal = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> atividades = pm.queryIntentActivities(principal, 0);
        for (ResolveInfo ri : atividades) {
            fora.add(ri.activityInfo.packageName);
        }
        fora.removeAll(naPolitica);
        // As Configurações ficam abertas para as telas liberadas; quem filtra é verificarTelaAberta
        fora.remove(Const.SETTINGS_PACKAGE_NAME);
        fora.remove(Const.SYSTEM_UI_PACKAGE_NAME);
        fora.remove(context.getPackageName());
        return fora;
    }

    private static void verificarTelaAberta(Context context) {
        Set<String> permitidas = classesPermitidas(context);
        if (permitidas == null) {
            ultimaConsulta = 0;
            return;
        }
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (power == null || !power.isInteractive()) {
            ultimaConsulta = 0;
            return;
        }
        UsageStatsManager usm = (UsageStatsManager) context.getSystemService(Context.USAGE_STATS_SERVICE);
        long agora = System.currentTimeMillis();
        long inicio = ultimaConsulta == 0 ? agora - JANELA_INICIAL_MS : ultimaConsulta;
        ultimaConsulta = agora;
        UsageEvents eventos = usm.queryEvents(inicio, agora);
        if (eventos == null) {
            if (!avisouSemPermissao) {
                Log.w(TAG, "Sem acesso ao uso: rode 'adb shell appops set com.hmdm.launcher GET_USAGE_STATS allow'");
                avisouSemPermissao = true;
            }
            return;
        }

        // Última tela que veio para a frente desde a consulta anterior
        String pacote = null, classe = null;
        UsageEvents.Event e = new UsageEvents.Event();
        while (eventos.hasNextEvent()) {
            eventos.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED) {
                pacote = e.getPackageName();
                classe = e.getClassName();
            }
        }
        if (!PACOTES_CONFIGURACOES.contains(pacote) || classe == null
                || permitida(classe, permitidas) || SEMPRE_PERMITIDAS.contains(classe)) {
            return;
        }
        Log.i(TAG, "Tela de configuração bloqueada: " + classe);
        voltarParaInicio(context);
        fecharJanelas(context, pacote);
    }

    // A janela das Configurações continuaria parada na tela bloqueada, e a próxima tentativa de
    // abrir o Wi-Fi reaproveitaria essa janela (e seria bloqueada também). Ocultar e mostrar de
    // novo o app (dono do aparelho) fecha o app e as janelas dele.
    private static void fecharJanelas(Context context, String pacote) {
        try {
            Thread.sleep(500);
            DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = LegacyUtils.getAdminComponentName(context);
            if (dpm.setApplicationHidden(admin, pacote, true)) {
                dpm.setApplicationHidden(admin, pacote, false);
            }
        } catch (Exception e) {
            Log.w(TAG, "Não fechou as janelas de " + pacote + ": " + e.getMessage());
        }
    }

    private static boolean permitida(String classe, Set<String> permitidas) {
        if (permitidas.contains(classe)) {
            return true;
        }
        for (String p : permitidas) {
            if (p.endsWith(".*") && classe.startsWith(p.substring(0, p.length() - 1))) {
                return true;
            }
        }
        return false;
    }

    private static void voltarParaInicio(Context context) {
        Intent inicio = new Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .setPackage(context.getPackageName())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        context.startActivity(inicio);
        new Handler(Looper.getMainLooper()).post(() ->
                Toast.makeText(context, "Configuração bloqueada pela empresa", Toast.LENGTH_SHORT).show());
    }
}
