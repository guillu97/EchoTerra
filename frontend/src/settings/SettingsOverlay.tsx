import { useStore } from "../store";
import { Overlay } from "../ui/Overlay";
import type { Settings } from "../store";
import { detectLang, LANG_FLAGS, LANG_NAMES, LANGS } from "../i18n";
import { useT } from "../i18n/useT";

const FPS_OPTS: Settings["fps"][] = [30, 60, 120];
const QUALITY_OPTS: Settings["quality"][] = ["Normal", "Medium", "High", "Very high"];
// Cadence de l'animation au repos (respiration des héros, monstres qui remuent).
// 0 = figés tant que rien ne bouge : c'est le mode le plus économe, mais la
// carte paraît morte. Voir voxel/unitAnim.ts.
// ⚠ on garde ici les libellés EN FRANÇAIS et on les traduit au rendu : une constante
// de module est évaluée une seule fois, au chargement, donc un `t()` posé ici figerait
// ces quatre mots dans la langue de départ et ils ne changeraient plus jamais.
const IDLE_ANIM_OPTS: { v: Settings["idleAnimFps"]; label: string }[] = [
  { v: 0, label: "Figée" },
  { v: 8, label: "Éco" },
  { v: 15, label: "Fluide" },
  { v: 30, label: "Max" },
];
// Effets de météo d'un thème (neige + ciel couvert au nord, vire-vents au désert).
// ⚠ « Aucun » ne fige pas l'effet : il ne le construit pas du tout. Voir voxel/weather.ts.
const WEATHER_OPTS: { v: Settings["weatherFps"]; label: string }[] = [
  { v: 0, label: "Aucun" },
  { v: 8, label: "Éco" },
  { v: 15, label: "Fluide" },
  { v: 30, label: "Max" },
];

function Banner({ title }: { title: string }) {
  return (
    <div className="banner" id="settings-title">
      {title}
    </div>
  );
}

export function SettingsOverlay() {
  const { settingsScreen, settings, appScreen, openSettings, closeSettings, updateSettings, leaveTown, toggleCheat } =
    useStore();
  const user = useStore((s) => s.user);
  const { t } = useT();
  const inGame = appScreen === "game";

  const Menu = (
    <div className="settings-pane">
      <Banner title={t("Paramètres")} />
      <div className="settings-menu">
        <button className="pill" onClick={() => openSettings("setting")}>{t("Jeu")}</button>
        <button className="pill" onClick={() => openSettings("language")}>{t("Langue")}</button>
        <button className="pill" onClick={() => openSettings("notifications")}>{t("Notifications")}</button>
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
              🔧 {t("Outils de test")}
            </button>
            <button className="pill red" onClick={() => leaveTown()}>{t("Quitter la partie")}</button>
            <button className="pill green" onClick={() => closeSettings()}>{t("Reprendre")}</button>
          </>
        ) : (
          <button className="pill green" onClick={() => closeSettings()}>{t("Retour")}</button>
        )}
      </div>
    </div>
  );

  const Setting = (
    <div className="settings-pane">
      <Banner title={t("Réglages du jeu")} />
      <div className="row">
        <span className="lbl">{t("Volume — Musique ({n}%)", { n: settings.music })}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.music}
          onChange={(e) => updateSettings({ music: Number(e.target.value) })}
        />
        <span className="lbl">{t("SFX ({n}%)", { n: settings.sfx })}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={settings.sfx}
          onChange={(e) => updateSettings({ sfx: Number(e.target.value) })}
        />
      </div>
      <div className="row">
        <span className="lbl">{t("Fréquence d'affichage")}</span>
        <div className="seg">
          {FPS_OPTS.map((f) => (
            <button key={f} className={settings.fps === f ? "on" : ""} onClick={() => updateSettings({ fps: f })}>
              {f} FPS
            </button>
          ))}
        </div>
        <span className="hint">
          {t("Réduire le taux de rafraîchissement économise la batterie et évite la surchauffe, mais peut affecter la fluidité.")}
        </span>
      </div>
      <div className="row">
        <span className="lbl">{t("Animation des personnages")}</span>
        <div className="seg">
          {IDLE_ANIM_OPTS.map((o) => (
            <button
              key={o.v}
              className={settings.idleAnimFps === o.v ? "on" : ""}
              onClick={() => updateSettings({ idleAnimFps: o.v })}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
        <span className="hint">
          {t(
            "Cadence de l'animation au repos : héros qui respirent, monstres qui remuent sur la carte. « Figée » les immobilise tant que rien ne bouge — la carte ne se redessine plus du tout au repos, c'est le réglage le plus économe en batterie. Les déplacements, attaques et morts restent toujours pleinement animés.",
          )}
        </span>
      </div>
      <div className="row">
        <span className="lbl">{t("Effets de météo")}</span>
        <div className="seg">
          {WEATHER_OPTS.map((o) => (
            <button
              key={o.v}
              className={settings.weatherFps === o.v ? "on" : ""}
              onClick={() => updateSettings({ weatherFps: o.v })}
            >
              {t(o.label)}
            </button>
          ))}
        </div>
        <span className="hint">
          {t(
            "Ce que le climat d'une expédition fait bouger : la neige qui tombe sous un ciel couvert en pays nordique, les vire-vents qui roulent au désert. « Aucun » ne les fige pas — il les supprime : plus une image demandée, plus un objet dans la scène. Une expédition tempérée n'a pas de météo et ne coûte rien quel que soit ce réglage.",
          )}
        </span>
      </div>
      <div className="row">
        <span className="lbl">{t("Qualité graphique")}</span>
        <div className="seg">
          {QUALITY_OPTS.map((q) => (
            <button key={q} className={settings.quality === q ? "on" : ""} onClick={() => updateSettings({ quality: q })}>
              {q}
            </button>
          ))}
        </div>
        <span className="hint">{t("Baisser la qualité réduit l'usage de batterie et la surchauffe.")}</span>
      </div>
      {(
        <div className="row">
          <span className="lbl">{t("Terrain voxel")}</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelSmooth === v ? "on" : ""}
                onClick={() => updateSettings({ voxelSmooth: v })}
              >
                {v ? t("Pentes voxel") : t("Blocs")}
              </button>
            ))}
          </div>
          <span className="hint">
            {t(
              "Pentes voxel = relief en petites marches de voxels (¼ de tuile, style diorama) ; Blocs = piliers pleine tuile. Carte monde uniquement.",
            )}
          </span>
        </div>
      )}
      {(
        <div className="row">
          <span className="lbl">{t("Rendu beauté (expérimental)")}</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelBeauty === v ? "on" : ""}
                onClick={() => updateSettings({ voxelBeauty: v })}
              >
                {v ? t("Cinématique") : t("Standard")}
              </button>
            ))}
          </div>
          <span className="hint">
            {t(
              "Lumière filmique (tone mapping ACES), halo lumineux sur les cristaux/fleurs, ciel dégradé et brume atmosphérique. Plus joli mais plus gourmand — coûte du GPU à chaque redraw.",
            )}
          </span>
        </div>
      )}
      {(
        <div className="row">
          <span className="lbl">{t("Rendu Signac (divisionniste)")}</span>
          <div className="seg">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                className={settings.voxelSignac === v ? "on" : ""}
                onClick={() => updateSettings({ voxelSignac: v })}
              >
                {v ? t("Peinture") : t("Normal|rendu")}
              </button>
            ))}
          </div>
          <span className="hint">
            {t(
              "Chaque facette de voxel devient sa propre touche de couleur pure, à la manière de Paul Signac : ombres violettes plutôt que grises, saturation haute, mélange optique. La touche est ancrée au MONDE — elle tourne et se resserre avec la géométrie, et les arêtes restent nettes.",
            )}
          </span>
        </div>
      )}
      {settings.voxelSignac && (
        <div className="row">
          <span className="lbl">{t("Intensité de la touche ({n}%)", { n: Math.round(settings.signacStrength * 100) })}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.signacStrength * 100)}
            onChange={(e) => updateSettings({ signacStrength: Number(e.target.value) / 100 })}
          />
          <span className="hint">{t("Au minimum, seul le parti pris de couleur reste ; au maximum, la trame de touches domine.")}</span>
        </div>
      )}
      <button className="pill green ov-close" onClick={() => openSettings("menu")}>
        Retour
      </button>
    </div>
  );

  // LE CHOIX DE LA LANGUE.
  //
  // ⚠ « Langue du navigateur » est une OPTION À PART ENTIÈRE, et c'est le défaut. Ce
  // n'est pas la même chose que de cocher « Français » sur un navigateur français : ne
  // rien choisir laisse le jeu suivre le navigateur pour toujours, y compris si son
  // porteur en change ou joue depuis un autre appareil. C'est aussi le seul moyen de
  // REVENIR au défaut une fois qu'on a choisi.
  //
  // Chaque langue s'écrit DANS SA LANGUE (« English », pas « Anglais ») : quelqu'un
  // qui tombe sur cet écran sans comprendre un mot de la langue courante doit pouvoir
  // y retrouver la sienne.
  const Language = (
    <div className="settings-pane">
      <Banner title={t("Langue")} />
      <div className="langgrid">
        <label key="auto">
          <input
            type="radio"
            name="lang"
            checked={settings.language === undefined}
            onChange={() => updateSettings({ language: undefined })}
          />
          🌐 {t("Langue du navigateur")} ({LANG_NAMES[detectLang()]})
        </label>
        {LANGS.map((l) => (
          <label key={l}>
            <input
              type="radio"
              name="lang"
              checked={settings.language === l}
              onChange={() => updateSettings({ language: l })}
            />
            {LANG_FLAGS[l]} {LANG_NAMES[l]}
          </label>
        ))}
      </div>
      <span className="hint">
        {user
          ? t("Ta langue est enregistrée dans ton compte : tu la retrouveras sur tous tes appareils.")
          : t("Ta langue est retenue sur cet appareil. Crée un compte pour la retrouver partout.")}
      </span>
      <button className="pill green ov-close" onClick={() => openSettings("menu")}>
        {t("Retour")}
      </button>
    </div>
  );

  const notifRows: { key: keyof Settings["notif"]; t: string; d: string }[] = [
    { key: "loot", t: t("Butin"), d: t("Me notifier de chaque fouille réussie.") },
    { key: "wave", t: t("Vague"), d: t("Me notifier 10 minutes avant chaque vague.") },
    { key: "actionPoint", t: t("Points d'action"), d: t("Me notifier quand la barre de PA est pleine.") },
    { key: "communication", t: t("Messages"), d: t("Me notifier quand un ami envoie un message privé.") },
  ];
  const Notifications = (
    <div className="settings-pane">
      <Banner title={t("Notifications")} />
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
        Retour
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
