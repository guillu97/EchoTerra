import { useStore } from "../store";
import type { Settings } from "../store";

const LANGUAGES = ["English", "Deutsch", "Italian", "Portugues", "Chinese", "Français", "Spanish", "Japanese"];
const FPS_OPTS: Settings["fps"][] = [30, 60, 120];
const QUALITY_OPTS: Settings["quality"][] = ["Normal", "Medium", "High", "Very high"];

function Banner({ title }: { title: string }) {
  return <div className="banner">{title}</div>;
}

export function SettingsOverlay() {
  const { settingsScreen, settings, appScreen, openSettings, closeSettings, updateSettings, leaveTown } =
    useStore();
  const inGame = appScreen === "game";

  const Menu = (
    <div className="panel-card">
      <Banner title="Parameter" />
      <div className="settings-menu">
        <button className="pill" onClick={() => openSettings("setting")}>Setting game</button>
        <button className="pill" onClick={() => openSettings("language")}>Language</button>
        <button className="pill" onClick={() => openSettings("notifications")}>Notifications</button>
        {inGame ? (
          <>
            <button className="pill red" onClick={() => leaveTown()}>Leave the town</button>
            <button className="pill green" onClick={() => closeSettings()}>Resume</button>
          </>
        ) : (
          <button className="pill green" onClick={() => closeSettings()}>Return</button>
        )}
      </div>
    </div>
  );

  const Setting = (
    <div className="panel-card">
      <Banner title="Setting" />
      <div className="row">
        <span className="lbl">Volume — Music ({settings.music}%)</span>
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
        <span className="lbl">Refresh rate</span>
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
        <span className="lbl">Quality graphic</span>
        <div className="seg">
          {QUALITY_OPTS.map((q) => (
            <button key={q} className={settings.quality === q ? "on" : ""} onClick={() => updateSettings({ quality: q })}>
              {q}
            </button>
          ))}
        </div>
        <span className="hint">Baisser la qualité réduit l'usage de batterie et la surchauffe.</span>
      </div>
      <button className="pill green" style={{ width: "100%", marginTop: 8 }} onClick={() => openSettings("menu")}>
        Return
      </button>
    </div>
  );

  const Language = (
    <div className="panel-card">
      <Banner title="Language" />
      <div className="langgrid">
        {LANGUAGES.map((l) => (
          <label key={l}>
            <input type="radio" name="lang" checked={settings.language === l} onChange={() => updateSettings({ language: l })} />
            {l}
          </label>
        ))}
      </div>
      <button className="pill green" style={{ width: "100%", marginTop: 12 }} onClick={() => openSettings("menu")}>
        Return
      </button>
    </div>
  );

  const notifRows: { key: keyof Settings["notif"]; t: string; d: string }[] = [
    { key: "loot", t: "Loot", d: "Me notifier de chaque fouille réussie." },
    { key: "wave", t: "Wave", d: "Me notifier 10 minutes avant chaque vague." },
    { key: "actionPoint", t: "Action point", d: "Me notifier quand la barre de PA est pleine." },
    { key: "communication", t: "Communication", d: "Me notifier quand un ami envoie un message privé." },
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
        Return
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
