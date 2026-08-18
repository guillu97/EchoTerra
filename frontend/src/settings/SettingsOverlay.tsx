import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import type { Settings } from "../store";
import { LOCALE_CODES, LOCALE_NAMES } from "../i18n";
import { useT } from "../i18n/useT";

const FPS_OPTS: Settings["fps"][] = [30, 60, 120];
const QUALITY_OPTS: Settings["quality"][] = ["Normal", "Medium", "High", "Very high"];
// Le libellé d'une qualité est traduit ; sa VALEUR (« Very high ») ne l'est pas
// — c'est elle qui est persistée et lue par le moteur de rendu.
const QUALITY_KEYS = {
  Normal: "settings.quality.normal",
  Medium: "settings.quality.medium",
  High: "settings.quality.high",
  "Very high": "settings.quality.veryHigh",
} as const;
// Cadence de l'animation au repos (respiration des héros, monstres qui remuent).
// 0 = figés tant que rien ne bouge : c'est le mode le plus économe, mais la
// carte paraît morte. Voir voxel/unitAnim.ts.
// ⚠ on garde la CLÉ et non le libellé : ce tableau est évalué une fois, au
// chargement du module — un libellé cuit ici ne changerait jamais de langue.
const IDLE_ANIM_OPTS = [
  { v: 0, key: "settings.idleAnim.frozen" },
  { v: 8, key: "settings.rate.eco" },
  { v: 15, key: "settings.rate.smooth" },
  { v: 30, key: "settings.rate.max" },
] as const;
// Effets de météo d'un thème (neige + ciel couvert au nord, vire-vents au désert).
// ⚠ « Aucun » ne fige pas l'effet : il ne le construit pas du tout. Voir voxel/weather.ts.
const WEATHER_OPTS = [
  { v: 0, key: "app.none" },
  { v: 8, key: "settings.rate.eco" },
  { v: 15, key: "settings.rate.smooth" },
  { v: 30, key: "settings.rate.max" },
] as const;

function Banner({ title }: { title: string }) {
  return (
    <div className="banner" id="settings-title">
      {title}
    </div>
  );
}

export function SettingsOverlay() {
  const T = useT();
  const { settingsScreen, settings, appScreen, openSettings, closeSettings, updateSettings, leaveTown, toggleCheat } =
    useStore();
  const inGame = appScreen === "game";

  const Menu = (
    <div className="settings-pane">
      <Banner title={T("settings.title")} />
      <div className="settings-menu">
        <button className="pill" onClick={() => openSettings("setting")}>{T("settings.game")}</button>
        <button className="pill" onClick={() => openSettings("language")}>{T("settings.language")}</button>
        <button className="pill" onClick={() => openSettings("notifications")}>{T("settings.notifications")}</button>
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
              🔧 {T("settings.devTools")}
            </button>
            <button className="pill red" onClick={() => leaveTown()}>{T("settings.quit")}</button>
            <button className="pill green" onClick={() => closeSettings()}>{T("app.resume")}</button>
          </>
        ) : (
          <button className="pill green" onClick={() => closeSettings()}>{T("app.back")}</button>
        )}
      </div>
    </div>
  );

  const Setting = (
    <div className="settings-pane">
      <Banner title={T("settings.gameTitle")} />
      <div className="row">
        <span className="lbl">{T("settings.music", { n: settings.music })}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.music}
          onChange={(e) => updateSettings({ music: Number(e.target.value) })}
        />
        <span className="lbl">{T("settings.sfx", { n: settings.sfx })}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.sfx}
          onChange={(e) => updateSettings({ sfx: Number(e.target.value) })}
        />
      </div>
      <div className="row">
        <span className="lbl">{T("settings.fps")}</span>
        <div className="seg">
          {FPS_OPTS.map((f) => (
            <button key={f} className={settings.fps === f ? "on" : ""} onClick={() => updateSettings({ fps: f })}>
              {f} FPS
            </button>
          ))}
        </div>
        <span className="hint">{T("settings.fps.hint")}</span>
      </div>
      <div className="row">
        <span className="lbl">{T("settings.idleAnim")}</span>
        <div className="seg">
          {IDLE_ANIM_OPTS.map((o) => (
            <button
              key={o.v}
              className={settings.idleAnimFps === o.v ? "on" : ""}
              onClick={() => updateSettings({ idleAnimFps: o.v })}
            >
              {T(o.key)}
            </button>
          ))}
        </div>
        <span className="hint">{T("settings.idleAnim.hint")}</span>
      </div>
      <div className="row">
        <span className="lbl">{T("settings.weather")}</span>
        <div className="seg">
          {WEATHER_OPTS.map((o) => (
            <button
              key={o.v}
              className={settings.weatherFps === o.v ? "on" : ""}
              onClick={() => updateSettings({ weatherFps: o.v })}
            >
              {T(o.key)}
            </button>
          ))}
        </div>
        <span className="hint">{T("settings.weather.hint")}</span>
      </div>
      <div className="row">
        <span className="lbl">{T("settings.quality")}</span>
        <div className="seg">
          {QUALITY_OPTS.map((q) => (
            <button key={q} className={settings.quality === q ? "on" : ""} onClick={() => updateSettings({ quality: q })}>
              {T(QUALITY_KEYS[q])}
            </button>
          ))}
        </div>
        <span className="hint">{T("settings.quality.hint")}</span>
      </div>
      {(
        <div className="row">
          <span className="lbl">{T("settings.terrain")}</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelSmooth === v ? "on" : ""}
                onClick={() => updateSettings({ voxelSmooth: v })}
              >
                {T(v ? "settings.terrain.slopes" : "settings.terrain.blocks")}
              </button>
            ))}
          </div>
          <span className="hint">{T("settings.terrain.hint")}</span>
        </div>
      )}
      {(
        <div className="row">
          <span className="lbl">{T("settings.beauty")}</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelBeauty === v ? "on" : ""}
                onClick={() => updateSettings({ voxelBeauty: v })}
              >
                {T(v ? "settings.beauty.cinematic" : "settings.beauty.standard")}
              </button>
            ))}
          </div>
          <span className="hint">{T("settings.beauty.hint")}</span>
        </div>
      )}
      {(
        <div className="row">
          <span className="lbl">{T("settings.signac")}</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelSignac === v ? "on" : ""}
                onClick={() => updateSettings({ voxelSignac: v })}
              >
                {T(v ? "settings.signac.painting" : "settings.signac.normal")}
              </button>
            ))}
          </div>
          <span className="hint">{T("settings.signac.hint")}</span>
        </div>
      )}
      {settings.voxelSignac && (
        <div className="row">
          <span className="lbl">{T("settings.signac.strength", { n: Math.round(settings.signacStrength * 100) })}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.signacStrength * 100)}
            onChange={(e) => updateSettings({ signacStrength: Number(e.target.value) / 100 })}
          />
          <span className="hint">{T("settings.signac.strength.hint")}</span>
        </div>
      )}
      <button className="pill green ov-close" onClick={() => openSettings("menu")}>
        {T("app.back")}
      </button>
    </div>
  );

  const Language = (
    <div className="settings-pane">
      <Banner title={T("settings.language")} />
      {/* ⚠ chaque langue est écrite DANS SA LANGUE (`LOCALE_NAMES`) : traduire
          « Japonais » en japonais servirait « 日本語 » à quelqu'un qui lit déjà
          le japonais, mais « Japanisch » à qui cherche justement à en sortir.
          Un sélecteur de langue est le seul écran qui ne doit pas obéir à la
          langue active. La première ligne, elle, se traduit : c'est un
          RÉGLAGE (« suis mon téléphone »), pas une langue. */}
      <div className="langgrid">
        <label key="auto">
          <input
            type="radio"
            name="lang"
            checked={settings.language === "auto"}
            onChange={() => updateSettings({ language: "auto" })}
          />
          {T("settings.language.auto")}
        </label>
        {LOCALE_CODES.map((code) => (
          <label key={code} lang={code}>
            <input
              type="radio"
              name="lang"
              checked={settings.language === code}
              onChange={() => updateSettings({ language: code })}
            />
            {LOCALE_NAMES[code]}
          </label>
        ))}
      </div>
      <span className="hint">{T("settings.language.hint")}</span>
      <button className="pill green ov-close" onClick={() => openSettings("menu")}>
        {T("app.back")}
      </button>
    </div>
  );

  const notifRows = (["loot", "wave", "actionPoint", "communication"] as const).map((key) => ({
    key,
    t: T(`settings.notif.${key}`),
    d: T(`settings.notif.${key}.desc`),
  }));
  const Notifications = (
    <div className="settings-pane">
      <Banner title={T("settings.notifications")} />
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
      <button className="pill green ov-close" onClick={() => openSettings("menu")}>
        {T("app.back")}
      </button>
    </div>
  );

  return (
    <Overlay
      onClose={inGame ? () => closeSettings() : undefined}
      closeOnBackdrop={inGame}
      cardClassName="settings-card"
      labelledBy="settings-title"
    >
      <>
        {settingsScreen === "menu" && Menu}
        {settingsScreen === "setting" && Setting}
        {settingsScreen === "language" && Language}
        {settingsScreen === "notifications" && Notifications}
      </>
    </Overlay>
  );
}
