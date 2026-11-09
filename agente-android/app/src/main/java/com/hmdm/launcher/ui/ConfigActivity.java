package com.hmdm.launcher.ui;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Customização MDM: tela do atalho "Config" da tela inicial.
 *
 * Mostra só os botões Wi-Fi e Tela (brilho, tempo da tela, tema escuro). As outras telas das
 * Configurações continuam bloqueadas pelo ModoRestrito. Aberta pelo app do tipo "intent"
 * com a ação com.hmdm.launcher.CONFIG cadastrado na política.
 */
public class ConfigActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int margem = dp(24);
        LinearLayout tela = new LinearLayout(this);
        tela.setOrientation(LinearLayout.VERTICAL);
        tela.setGravity(Gravity.CENTER_HORIZONTAL);
        tela.setPadding(margem, dp(48), margem, margem);

        TextView titulo = new TextView(this);
        titulo.setText("Config");
        titulo.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        titulo.setPadding(0, 0, 0, dp(32));
        tela.addView(titulo);

        tela.addView(botao("Wi-Fi", Settings.ACTION_WIFI_SETTINGS));
        tela.addView(botao("Tela (brilho e tempo da tela)", Settings.ACTION_DISPLAY_SETTINGS));

        setContentView(tela);
    }

    private Button botao(String texto, String acao) {
        Button b = new Button(this);
        b.setText(texto);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setOnClickListener(v -> {
            try {
                startActivity(new Intent(acao));
            } catch (Exception e) {
                Toast.makeText(this, "Não foi possível abrir " + texto, Toast.LENGTH_SHORT).show();
            }
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(64));
        lp.bottomMargin = dp(16);
        b.setLayoutParams(lp);
        return b;
    }

    private int dp(int valor) {
        return Math.round(valor * getResources().getDisplayMetrics().density);
    }
}
