package com.hmdm.launcher.pro;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import com.hmdm.launcher.BuildConfig;
import com.hmdm.launcher.helper.CryptoHelper;
import com.hmdm.launcher.helper.SettingsHelper;
import com.hmdm.launcher.util.LegacyUtils;
import com.hmdm.launcher.util.Utils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Customização MDM: bloqueio de apps por horário.
 *
 * A cada minuto baixa do portal as regras deste aparelho (GET /api/agente/bloqueios),
 * guarda uma cópia e confere a hora. Dentro da janela de uma regra, os apps dela ficam
 * "pausados" (DevicePolicyManager.setPackagesSuspended): o app não abre, mas continua
 * instalado e com os dados. Sem conexão, vale a última cópia das regras.
 *
 * Também envia ao portal a lista de apps instalados (nome + ícone), para o portal mostrar
 * os apps reais do celular na hora de escolher o que bloquear.
 *
 * Os apps bloqueados pelo horário também somem da tela inicial (ver ocultosPorHorario) e
 * voltam quando o horário libera. Só envia quando a lista muda
 * (ou a cada 6 h).
 */
public class BloqueioApps {
    private static final String TAG = "BloqueioApps";
    private static final String PREFS = "bloqueio_apps";
    private static final String PREF_REGRAS = "regras";
    private static final String PREF_FUSO = "fuso";
    private static final String PREF_PAUSADOS = "pausados";
    private static final String PREF_OCULTOS = "ocultos";
    private static final String PREF_APPS_HASH = "apps_hash";
    private static final String PREF_APPS_ENVIO = "apps_envio";
    private static final long INTERVALO_SEGUNDOS = 60;
    private static final long REENVIO_APPS_MS = 6 * 60 * 60 * 1000L;
    private static final int TAMANHO_ICONE = 72;

    private static ScheduledExecutorService executor;

    public static synchronized void iniciar(Context context) {
        if (executor != null) {
            return;
        }
        final Context appContext = context.getApplicationContext();
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(() -> {
            try {
                verificar(appContext);
            } catch (Throwable e) {
                Log.w(TAG, "Falha ao verificar bloqueios", e);
            }
        }, 15, INTERVALO_SEGUNDOS, TimeUnit.SECONDS);
    }

    private static void verificar(Context context) throws Exception {
        if (!Utils.isDeviceOwner(context) || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return;
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            baixarRegras(context, prefs);
        } catch (Exception e) {
            // Sem conexão com o portal: continua com a última cópia das regras
            Log.i(TAG, "Portal indisponível, usando regras guardadas: " + e.getMessage());
        }
        aplicar(context, prefs);
        try {
            enviarApps(context, prefs);
        } catch (Exception e) {
            Log.i(TAG, "Não enviou a lista de apps: " + e.getMessage());
        }
    }

    // Lista de apps com ícone na tela (os que a pessoa consegue abrir)
    private static void enviarApps(Context context, SharedPreferences prefs) throws Exception {
        String deviceId = SettingsHelper.getInstance(context).getDeviceId();
        if (deviceId == null || deviceId.isEmpty()) {
            return;
        }
        PackageManager pm = context.getPackageManager();
        Intent principal = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> atividades = pm.queryIntentActivities(principal, 0);
        Set<String> pacotes = new TreeSet<>();
        for (ResolveInfo ri : atividades) {
            pacotes.add(ri.activityInfo.packageName);
        }
        pacotes.remove(context.getPackageName());
        String hash = CryptoHelper.getSHA1String(pacotes.toString());
        long agora = System.currentTimeMillis();
        if (hash.equals(prefs.getString(PREF_APPS_HASH, ""))
                && agora - prefs.getLong(PREF_APPS_ENVIO, 0) < REENVIO_APPS_MS) {
            return;
        }

        JSONArray apps = new JSONArray();
        for (String pkg : pacotes) {
            JSONObject app = new JSONObject();
            app.put("pacote", pkg);
            try {
                app.put("nome", pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString());
                app.put("icone", iconeEmBase64(pm.getApplicationIcon(pkg)));
            } catch (Exception e) {
                app.put("nome", pkg);
            }
            apps.put(app);
        }
        String ts = String.valueOf(agora);
        JSONObject body = new JSONObject();
        body.put("aparelho", deviceId);
        body.put("ts", ts);
        body.put("apps", apps);

        HttpURLConnection conn = (HttpURLConnection) new URL(ProUtils.getPortalUrl(context) + "/api/agente/apps").openConnection();
        try {
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-Assinatura", CryptoHelper.getSHA1String(BuildConfig.PORTAL_SECRET + deviceId + ts));
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int codigo = conn.getResponseCode();
            if (codigo != 200) {
                throw new Exception("HTTP " + codigo);
            }
        } finally {
            conn.disconnect();
        }
        prefs.edit().putString(PREF_APPS_HASH, hash).putLong(PREF_APPS_ENVIO, agora).apply();
        Log.i(TAG, "Lista de apps enviada (" + pacotes.size() + " apps)");
    }

    private static String iconeEmBase64(Drawable icone) {
        Bitmap bmp = Bitmap.createBitmap(TAMANHO_ICONE, TAMANHO_ICONE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bmp);
        icone.setBounds(0, 0, TAMANHO_ICONE, TAMANHO_ICONE);
        icone.draw(canvas);
        ByteArrayOutputStream saida = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, saida);
        bmp.recycle();
        return Base64.encodeToString(saida.toByteArray(), Base64.NO_WRAP);
    }

    private static void baixarRegras(Context context, SharedPreferences prefs) throws Exception {
        String deviceId = SettingsHelper.getInstance(context).getDeviceId();
        if (deviceId == null || deviceId.isEmpty()) {
            return;
        }
        String ts = String.valueOf(System.currentTimeMillis());
        URL url = new URL(ProUtils.getPortalUrl(context) + "/api/agente/bloqueios?aparelho="
                + URLEncoder.encode(deviceId, "UTF-8") + "&ts=" + ts);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("X-Assinatura", CryptoHelper.getSHA1String(BuildConfig.PORTAL_SECRET + deviceId + ts));
            int codigo = conn.getResponseCode();
            if (codigo == 404) {
                // Aparelho não cadastrado no servidor: nenhuma regra vale
                prefs.edit().putString(PREF_REGRAS, "[]").apply();
                return;
            }
            if (codigo != 200) {
                throw new Exception("HTTP " + codigo);
            }
            JSONObject resposta = new JSONObject(ler(conn.getInputStream()));
            prefs.edit()
                    .putString(PREF_REGRAS, resposta.getJSONArray("regras").toString())
                    .putString(PREF_FUSO, resposta.optString("fuso", ""))
                    .apply();
        } finally {
            conn.disconnect();
        }
    }

    private static String ler(InputStream in) throws Exception {
        try (InputStream entrada = in) {
            ByteArrayOutputStream saida = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = entrada.read(buf)) > 0) {
                saida.write(buf, 0, n);
            }
            return new String(saida.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void aplicar(Context context, SharedPreferences prefs) throws Exception {
        String fuso = prefs.getString(PREF_FUSO, "");
        Calendar agora = fuso.isEmpty() ? Calendar.getInstance() : Calendar.getInstance(TimeZone.getTimeZone(fuso));
        int dia = agora.get(Calendar.DAY_OF_WEEK) - 1;   // 0 = domingo, como no portal
        int minutos = agora.get(Calendar.HOUR_OF_DAY) * 60 + agora.get(Calendar.MINUTE);

        Set<String> bloquear = new HashSet<>();
        JSONArray regras = new JSONArray(prefs.getString(PREF_REGRAS, "[]"));
        for (int i = 0; i < regras.length(); i++) {
            JSONObject r = regras.getJSONObject(i);
            if (dentroDaJanela(r, dia, minutos)) {
                JSONArray pacotes = r.getJSONArray("pacotes");
                for (int j = 0; j < pacotes.length(); j++) {
                    bloquear.add(pacotes.getString(j));
                }
            }
        }
        // Grava antes de pausar: a tela inicial redesenha quando o Android avisa da pausa
        prefs.edit().putStringSet(PREF_OCULTOS, new HashSet<>(bloquear)).commit();

        // Modo restrito: apps fora da política também ficam pausados (o tempo todo)
        bloquear.addAll(ModoRestrito.appsForaDaPolitica(context));
        ModoRestrito.atualizarAppsDoQuiosque(context);
        bloquear.remove(context.getPackageName());

        Set<String> pausados = new HashSet<>(prefs.getStringSet(PREF_PAUSADOS, new HashSet<>()));
        Set<String> liberar = new HashSet<>(pausados);
        liberar.removeAll(bloquear);

        DevicePolicyManager dpm = (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = LegacyUtils.getAdminComponentName(context);
        if (!liberar.isEmpty()) {
            dpm.setPackagesSuspended(admin, liberar.toArray(new String[0]), false);
            Log.i(TAG, "Liberados: " + liberar);
        }
        if (!bloquear.isEmpty()) {
            // Repete a cada minuto: também pega apps instalados depois que a janela começou
            String[] falhas = dpm.setPackagesSuspended(admin, bloquear.toArray(new String[0]), true);
            if (!pausados.containsAll(bloquear)) {
                Log.i(TAG, "Bloqueados: " + bloquear + (falhas != null && falhas.length > 0 ? " (não instalados ou não permitidos: " + String.join(",", falhas) + ")" : ""));
            }
        }
        prefs.edit().putStringSet(PREF_PAUSADOS, bloquear).apply();
    }

    // Apps bloqueados pelo horário neste momento: a tela inicial não mostra o ícone deles
    public static Set<String> ocultosPorHorario(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet(PREF_OCULTOS, new HashSet<>());
    }

    // Mesma regra do portal: janela que passa da meia-noite vale pelo dia em que começou
    private static boolean dentroDaJanela(JSONObject r, int dia, int minutos) throws Exception {
        int ini = paraMinutos(r.getString("inicio"));
        int fim = paraMinutos(r.getString("fim"));
        JSONArray dias = r.getJSONArray("dias");
        if (ini < fim) {
            return temDia(dias, dia) && minutos >= ini && minutos < fim;
        }
        if (minutos >= ini) {
            return temDia(dias, dia);
        }
        return minutos < fim && temDia(dias, (dia + 6) % 7);
    }

    private static boolean temDia(JSONArray dias, int dia) throws Exception {
        for (int i = 0; i < dias.length(); i++) {
            if (dias.getInt(i) == dia) {
                return true;
            }
        }
        return false;
    }

    private static int paraMinutos(String hhmm) {
        String[] p = hhmm.split(":");
        return Integer.parseInt(p[0]) * 60 + Integer.parseInt(p[1]);
    }
}
