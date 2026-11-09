/*
 * Headwind MDM: Open Source Android MDM Software
 * https://h-mdm.com
 *
 * Copyright (C) 2019 Headwind Solutions LLC (http://h-sms.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package com.hmdm.launcher.pro;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.view.View;

import android.content.IntentFilter;
import android.os.BatteryManager;

import com.hmdm.launcher.BuildConfig;
import com.hmdm.launcher.R;
import com.hmdm.launcher.helper.CryptoHelper;
import com.hmdm.launcher.helper.SettingsHelper;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import com.hmdm.launcher.json.ServerConfig;

import java.util.Calendar;

/**
 * These functions are available in Pro-version only
 * In a free version, the class contains stubs
 */
public class ProUtils {

    public static boolean isPro() {
        return false;
    }

    public static boolean kioskModeRequired(Context context) {
        return false;
    }

    public static void initCrashlytics(Context context) {
        // Stub
    }

    public static void sendExceptionToCrashlytics(Throwable e) {
        // Stub
    }

    // Start the service checking if the foreground app is allowed to the user (by usage statistics)
    public static boolean checkAccessibilityService(Context context) {
        // Stub
        return true;
    }

    // Pro-version
    public static boolean checkUsageStatistics(Context context) {
        // Stub
        return true;
    }

    // Add a transparent view on top of the status bar which prevents user interaction with the status bar
    public static View preventStatusBarExpansion(Activity activity) {
        // Stub
        return null;
    }

    // Add a transparent view on top of a swipeable area at the right (opens app list on Samsung tablets)
    public static View preventApplicationsList(Activity activity) {
        // Stub
        return null;
    }

    public static View createKioskUnlockButton(Activity activity) {
        // Stub
        return null;
    }

    public static boolean isKioskAppInstalled(Context context) {
        // Stub
        return false;
    }

    public static boolean isKioskModeRunning(Context context) {
        // Stub
        return false;
    }

    public static Intent getKioskAppIntent(String kioskApp, Activity activity) {
        // Stub
        return null;
    }

    // Start COSU kiosk mode
    public static boolean startCosuKioskMode(String kioskApp, Activity activity, boolean enableSettings) {
        // Stub
        return false;
    }

    // Set/update kiosk mode options (lock tack features)
    public static void updateKioskOptions(Activity activity) {
        // Stub
    }

    // Update app list in the kiosk mode
    public static void updateKioskAllowedApps(String kioskApp, Activity activity, boolean enableSettings) {
        // Stub
    }

    public static void unlockKiosk(Activity activity) {
        // Stub
    }

    public static void processConfig(Context context, ServerConfig config) {
        // Stub
    }

    // Customização MDM: envia a localização ao servidor a cada atualização do GPS
    // (o LocationService pede atualizações a cada 60 s), no máximo uma vez por minuto
    private static final long LOCATION_SEND_INTERVAL_MS = 55000;
    private static long lastLocationSendTime = 0;
    // Posição mais precisa recebida desde o último envio. GPS e antena chegam separados, e a da
    // antena (erro de ~100 m) não deve tomar o lugar da do GPS (~10 m), senão o trajeto sai das ruas.
    private static Location bestLocation;
    private static String bestProvider;

    public static synchronized void processLocation(Context context, Location location, String provider) {
        long now = System.currentTimeMillis();
        if (bestLocation == null || accuracy(location) <= accuracy(bestLocation)) {
            bestLocation = location;
            bestProvider = provider;
        }
        if (now - lastLocationSendTime < LOCATION_SEND_INTERVAL_MS) {
            return;
        }
        lastLocationSendTime = now;
        final Location toSend = bestLocation;
        final String toSendProvider = bestProvider;
        bestLocation = null;
        final Context appContext = context.getApplicationContext();
        new Thread(() -> {
            try {
                sendLocationToPortal(appContext, toSend, toSendProvider);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }).start();
    }

    // Altitude em metros acima do nível do mar (Android 14+); antes disso, a do GPS (pode variar uns 10 m)
    private static Object altitude(Location location) {
        if (android.os.Build.VERSION.SDK_INT >= 34 && location.hasMslAltitude()) {
            return location.getMslAltitudeMeters();
        }
        return location.hasAltitude() ? location.getAltitude() : JSONObject.NULL;
    }

    private static float accuracy(Location location) {
        return location.hasAccuracy() ? location.getAccuracy() : Float.MAX_VALUE;
    }

    // URL do envio da localização: BuildConfig.LOCATION_URL ou, se vazio, o portal no host do servidor MDM
    private static String getLocationUrl(Context context) throws Exception {
        if (!BuildConfig.LOCATION_URL.isEmpty()) {
            return BuildConfig.LOCATION_URL;
        }
        return getPortalUrl(context) + "/api/localizacao";
    }

    // Endereço do portal (sem barra no fim): tirado de LOCATION_URL ou host do servidor MDM na porta 8090
    public static String getPortalUrl(Context context) throws Exception {
        if (!BuildConfig.LOCATION_URL.isEmpty()) {
            return BuildConfig.LOCATION_URL.replaceFirst("/api/localizacao/?$", "");
        }
        URL base = new URL(SettingsHelper.getInstance(context).getBaseUrl());
        return base.getProtocol() + "://" + base.getHost() + ":8090";
    }

    private static void sendLocationToPortal(Context context, Location location, String provider) throws Exception {
        String deviceId = SettingsHelper.getInstance(context).getDeviceId();
        if (deviceId == null || deviceId.isEmpty()) {
            return;
        }
        Intent battery = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        int batteryLevel = -1;
        if (battery != null) {
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) {
                batteryLevel = level * 100 / scale;
            }
        }
        long ts = location.getTime();

        JSONObject body = new JSONObject();
        body.put("aparelho", deviceId);
        body.put("lat", location.getLatitude());
        body.put("lon", location.getLongitude());
        body.put("precisao", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        body.put("velocidade", location.hasSpeed() ? location.getSpeed() * 3.6 : JSONObject.NULL);
        body.put("altitude", altitude(location));
        body.put("bateria", batteryLevel >= 0 ? batteryLevel : JSONObject.NULL);
        body.put("fonte", provider);
        body.put("ts", ts);

        HttpURLConnection conn = (HttpURLConnection) new URL(getLocationUrl(context)).openConnection();
        try {
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setRequestProperty("X-Assinatura",
                    CryptoHelper.getSHA1String(BuildConfig.PORTAL_SECRET + deviceId + ts));
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            conn.getResponseCode();
        } finally {
            conn.disconnect();
        }
    }

    public static String getAppName(Context context) {
        return context.getString(R.string.app_name);
    }

    public static String getCopyright(Context context) {
        return "(c) " + Calendar.getInstance().get(Calendar.YEAR) + " " + context.getString(R.string.vendor);
    }
}
