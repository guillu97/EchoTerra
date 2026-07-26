import { useStore } from "../store";
import type { Settings } from "../store";

const LANGUAGES = ["English", "Deutsch", "Italian", "Portugues", "Chinese", "Français", "Spanish", "Japanese"];
const FPS_OPTS: Settings["fps"][] = [30, 60, 120];
const QUALITY_OPTS: Settings["quality"][] = ["Normal", "Medium", "High", "Very high"];

function Banner({ title }: { title: string }) {
  return <div className="banner">{title}</div>;
}

export function SettingsOverlay() {
  const { settingsScreen, settings, appScreen, openSettings, closeSettings, updateSettings, leaveTown, toggleCheat } =
    useStore();
  const inGame = appScreen === "game";

  const Menu = (
    <div className="panel-card">
      <Banner title="Paramètres" />
      <div className="settings-menu">
        <button className="pill" onClick={() => openSettings("setting")}>Jeu</button>
        <button className="pill" onClick={() => openSettings("language")}>Langue</button>
        <button className="pill" onClick={() => openSettings("notifications")}>Notifications</button>
        {inGame ? (
          <>
            {/* La triche a quitté la TopBar (8 éléments sur 390px, ça débordait)
                mais reste accessible dans tous les builds, comme demandé. */}
            <button
              className="pill cream"
              onClick={() => {
                closeSettings();
                toggleCheat();
              }}
            >
              🔧 Outils de test
            </button>
            <button className="pill red" onClick={() => leaveTown()}>Quitter la partie</button>
            <button className="pill green" onClick={() => closeSettings()}>Reprendre</button>
          </>
        ) : (
          <button className="pill green" onClick={() => closeSettings()}>Retour</button>
        )}
      </div>
    </div>
  );

  const Setting = (
    <div className="panel-card">
      <Banner title="Réglages du jeu" />
      <div className="row">
        <span className="lbl">Volume — Musique ({settings.music}%)</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.music}
          onChange={(e) => updateSettings({ music: Number(e.target.value) })}
        />
        <span className="lbl">SFX ({settings.sfx}%)</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.sfx}
          onChange={(e) => updateSettings({ sfx: Number(e.target.value) })}
        />
      </div>
      <div className="row">
        <span className="lbl">Fréquence d'affichage</span>
        <div className="seg">
          {FPS_OPTS.map((f) => (
            <button key={f} className={settings.fps === f ? "on" : ""} onClick={() => updateSettings({ fps: f })}>
              {f} FPS
            </button>
          ))}
        </div>
        <span className="hint">
          Réduire le taux de rafraîchissement économise la batterie et évite la surchauffe, mais peut affecter la fluidité.
        </span>
      </div>
      <div className="row">
        <span className="lbl">Qualité graphique</span>
        <div className="seg">
          {QUALITY_OPTS.map((q) => (
            <button key={q} className={settings.quality === q ? "on" : ""} onClick={() => updateSettings({ quality: q })}>
              {q}
            </button>
          ))}
        </div>
        <span className="hint">Baisser la qualité réduit l'usage de batterie et la surchauffe.</span>
      </div>
      <div className="row">
        <span className="lbl">Carte voxel (expérimental)</span>
        <div className="seg">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              className={settings.voxelMap === v ? "on" : ""}
              onClick={() => updateSettings({ voxelMap: v })}
            >
              {v ? "Voxel 3D" : "Classique"}
            </button>
          ))}
        </div>
        <span className="hint">
          Rendu 3D voxel (Map, Combat, Home) avec rotation de caméra (↻) — le défaut. « Classique » rebascule sur l'ancien rendu iso.
        </span>
      </div>
      {settings.voxelMap && (
        <div className="row">
          <span className="lbl">Terrain voxel</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelSmooth === v ? "on" : ""}
                onClick={() => updateSettings({ voxelSmooth: v })}
              >
                {v ? "Pentes voxel" : "Blocs"}
              </button>
            ))}
          </div>
          <span className="hint">
            Pentes voxel = relief en petites marches de voxels (¼ de tuile, style diorama) ; Blocs = piliers pleine tuile. Carte monde uniquement.
          </span>
        </div>
      )}
      {settings.voxelMap && (
        <div className="row">
          <span className="lbl">Rendu beauté (expérimental)</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelBeauty === v ? "on" : ""}
                onClick={() => updateSettings({ voxelBeauty: v })}
              >
                {v ? "Cinématique" : "Standard"}
              </button>
            ))}
          </div>
          <span className="hint">
            Lumière filmique (tone mapping ACES), halo lumineux sur les cristaux/fleurs, ciel dégradé et brume atmosphérique. Plus joli mais plus gourmand — coûte du GPU à chaque redraw.
          </span>
        </div>
      )}
      <button className="pill green" style={{ width: "100%", marginTop: 8 }} onClick={() => openSettings("menu")}>
        Retour
      </button>
    </div>
  );

  const Language = (
    <div className="panel-card">
      <Banner title="Langue" />
      <div className="langgrid">
        {LANGUAGES.map((l) => (
          <label key={l}>
            <input type="radio" name="lang" checked={settings.language === l} onChange={() => updateSettings({ language: l })} />
            {l}
          </label>
        ))}
      </div>
      <button className="pill green" style={{ width: "100%", marginTop: 12 }} onClick={() => openSettings("menu")}>
        Retour
      </button>
    </div>
  );

  const notifRows: { key: keyof Settings["notif"]; t: string; d: string }[] = [
    { key: "loot", t: "Butin", d: "Me notifier de chaque fouille réussie." },
    { key: "wave", t: "Vague", d: "Me notifier 10 minutes avant chaque vague." },
    { key: "actionPoint", t: "Points d'action", d: "Me notifier quand la barre de PA est pleine." },
    { key: "communication", t: "Messages", d: "Me notifier quand un ami envoie un message privé." },
  ];
  const Notifications = (
    <div className="panel-card">
      <Banner title="Notifications" />
      {notifRows.map((r) => (
        <div className="toggle-row" key={r.key}>
          <div>
            <div className="t">{r.t}</div>
            <div className="d">{r.d}</div>
          </div>
          <button
            className={`switch ${settings.notif[r.key] ? "on" : ""}`}
            aria-label={r.t}
            onClick={() => updateSettings({ notif: { ...settings.notif, [r.key]: !settings.notif[r.key] } })}
          />
        </div>
      ))}
      <button className="pill green" style={{ width: "100%", marginTop: 8 }} onClick={() => openSettings("menu")}>
        Retour
      </button>
    </div>
  );

  return (
    <div className="settings" onClick={() => (inGame ? closeSettings() : undefined)}>
      <div onClick={(e) => e.stopPropagation()} style={{ margin: "auto", width: "100%", display: "flex" }}>
        {settingsScreen === "menu" && Menu}
        {settingsScreen === "setting" && Setting}
        {settingsScreen === "language" && Language}
        {settingsScreen === "notifications" && Notifications}
      </div>
    </div>
  );
}
