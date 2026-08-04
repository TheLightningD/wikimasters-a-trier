(() => {
  if (window.__WM_TRI__) return;
  if (location.hostname !== "www.wiki-masters.com" && document.documentElement.dataset.wmTest !== "1") return;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const label = el => norm([el.innerText, el.value, el.getAttribute("aria-label"), el.title].filter(Boolean).join(" "));
  const visible = el => !!(el && el.isConnected && !el.disabled && el.getAttribute("aria-disabled") !== "true" && el.getClientRects().length);
  const controls = () => [...document.querySelectorAll('button,[role="button"],[role="option"],[role="menuitem"],input[type="button"],input[type="submit"],a[href]')]
    .filter(el => visible(el) && !el.closest("#wm-tri-panel"));
  const find = (regex, unused) => controls().find(el => regex.test(label(el)) && (!unused || !state.used.has(el)));
  const waitFor = async (fn, timeout = 3000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end && state.running) {
      const result = fn();
      if (result) return result;
      await sleep(100);
    }
    return null;
  };

  const PACK = /(?:ouvrir|reclamer|recuperer).*(?:paquet|pack)|(?:paquet|pack).*(?:ouvrir|disponible)|nouveau (?:paquet|pack)/;
  const REVEAL = /reveler|retourner|decouvrir|voir la carte/;
  const LABEL_TRIGGER = /etiquette|etiqueter|label|tag|classer/;
  const CONTINUE = /continuer|terminer|suivant|fermer|ajouter.*collection|collectionner|conserver/;
  const DANGER = /acheter|paiement|vendre|supprimer|echanger/;

  const state = window.__WM_TRI__ = {
    running: false,
    used: new WeakSet(),
    stats: { packs: 0, cards: 0 },
    logs: []
  };

  const panel = document.createElement("aside");
  panel.id = "wm-tri-panel";
  panel.innerHTML = `
    <strong>WikiMasters · À trier</strong>
    <span id="wm-tri-status">Prêt</span>
    <button id="wm-tri-start">Tout traiter</button>
    <button id="wm-tri-stop" hidden>Arrêter</button>`;
  panel.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:220px;padding:14px;display:grid;gap:9px;border:1px solid #555;border-radius:12px;background:#17171b;color:#fff;box-shadow:0 8px 30px #0008;font:14px system-ui";
  panel.querySelectorAll("button").forEach(button => button.style.cssText = "padding:9px;border:0;border-radius:8px;cursor:pointer;font-weight:700");
  (document.body || document.documentElement).append(panel);

  const statusEl = panel.querySelector("#wm-tri-status");
  const startEl = panel.querySelector("#wm-tri-start");
  const stopEl = panel.querySelector("#wm-tri-stop");
  const report = message => {
    state.logs.push(message);
    statusEl.textContent = `${message} · ${state.stats.packs} pack(s), ${state.stats.cards} carte(s)`;
  };
  const setRunning = running => {
    state.running = running;
    startEl.hidden = running;
    stopEl.hidden = !running;
  };

  const targetOption = () => controls().find(el => {
    if (label(el) !== "a trier") return false;
    const role = el.getAttribute("role");
    const popup = el.closest('[role="dialog"],[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]');
    return !!popup || ["option", "menuitem", "checkbox"].includes(role);
  });

  async function labelOne() {
    let option = targetOption();
    if (option) {
      if (option.getAttribute("aria-selected") === "true" || option.getAttribute("aria-checked") === "true") return false;
      option.click();
      state.stats.cards++;
      report("Étiquette ajoutée");
      await sleep(300);
      return true;
    }

    const trigger = find(LABEL_TRIGGER, true);
    if (!trigger || DANGER.test(label(trigger))) return false;
    state.used.add(trigger);
    trigger.click();
    option = await waitFor(targetOption, 2500);
    if (!option) return true;
    if (option.getAttribute("aria-selected") !== "true" && option.getAttribute("aria-checked") !== "true") {
      option.click();
      state.stats.cards++;
      report("Étiquette ajoutée");
    }
    await sleep(300);
    return true;
  }

  async function processPack(packButton) {
    const before = state.stats.cards;
    packButton.click();
    state.stats.packs++;
    report("Pack ouvert");
    await sleep(600);
    const deadline = Date.now() + 45000;
    let idleSince = Date.now();

    while (state.running && Date.now() < deadline) {
      const reveal = find(REVEAL, true);
      if (reveal && !DANGER.test(label(reveal))) {
        state.used.add(reveal);
        reveal.click();
        idleSince = Date.now();
        await sleep(300);
        continue;
      }
      if (await labelOne()) {
        idleSince = Date.now();
        continue;
      }
      const next = find(CONTINUE);
      if (next && state.stats.cards > before) {
        next.click();
        await sleep(600);
        return;
      }
      if (Date.now() - idleSince > 5000) {
        if (state.stats.cards === before) throw new Error("Pack ouvert, mais commande d’étiquette introuvable");
        return;
      }
      await sleep(200);
    }
    if (state.running) throw new Error("Délai dépassé pendant le traitement du pack");
  }

  async function run() {
    if (state.running) return;
    state.stats = { packs: 0, cards: 0 };
    state.logs.length = 0;
    state.used = new WeakSet();
    setRunning(true);
    try {
      while (state.running) {
        const pack = find(PACK);
        if (!pack || DANGER.test(label(pack))) break;
        await processPack(pack);
      }
      if (state.running) report(state.stats.packs ? "Terminé" : "Aucun nouveau pack trouvé");
    } catch (error) {
      report(error.message);
    } finally {
      setRunning(false);
      document.dispatchEvent(new CustomEvent("wm-tri-finished", { detail: state.stats }));
    }
  }

  startEl.addEventListener("click", run);
  stopEl.addEventListener("click", () => { setRunning(false); report("Arrêté"); });
})();
