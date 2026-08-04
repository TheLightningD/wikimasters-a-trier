(() => {
  if (window.__WM_TRI__) return;
  if (location.hostname !== "www.wiki-masters.com" && document.documentElement.dataset.wmTest !== "1") return;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const norm = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const label = el => norm([el.innerText, el.value, el.getAttribute("aria-label"), el.getAttribute("placeholder"), el.title].filter(Boolean).join(" "));
  const visible = el => !!(el && el.isConnected && !el.disabled && el.getAttribute("aria-disabled") !== "true" && el.getClientRects().length);
  const controls = () => [...document.querySelectorAll('button,[role="button"],[role="combobox"],[role="option"],[role="menuitem"],input:not([type]),input[type="text"],input[type="search"],input[type="button"],input[type="submit"],a[href]')]
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

  const PACK = /^ouvrir$|(?:ouvrir|reclamer|recuperer).*(?:paquet|pack)|(?:paquet|pack).*(?:ouvrir|disponible)|nouveau (?:paquet|pack)/;
  const LABEL_TRIGGER = /etiquette|etiqueter|label|tag|classer/;
  const CONTINUE = /continuer|terminer|suivant|fermer|ajouter.*collection|collectionner|conserver/;
  const MORE_CARDS = /encore \d+ carte/;
  const DANGER = /acheter|paiement|vendre|supprimer|echanger/;
  const COLLECTION = document.documentElement.dataset.wmMode === "collection";

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

  const targetOption = () => controls().find(el => el.matches('button,[role="button"]') && label(el) === "a trier");
  const hasTargetLabel = () => controls().some(el => /retirer.*etiquette.*a trier/.test(label(el)));

  async function applyLabel(trigger, strict = false) {
    state.used.add(trigger);
    trigger.focus();
    trigger.click();
    let option = await waitFor(targetOption, 1000);
    if (!option) {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
      option = await waitFor(targetOption, 1500);
    }
    if (!option) {
      if (strict) {
        const hints = [...document.querySelectorAll('button,[role],input')]
          .filter(visible)
          .map(el => label(el))
          .filter(value => /etiqu|label|tag|trier|ajouter|recherch|creer/.test(value))
          .slice(0, 12);
        throw new Error(`Option « à trier » introuvable (contrôles: ${hints.join(' | ') || 'aucun'})`);
      }
      return true;
    }
    option.click();
    await sleep(300);
    return true;
  }

  async function labelOne() {
    if (hasTargetLabel()) {
      return "existing";
    }
    let option = targetOption();
    if (option) {
      option.click();
      await sleep(300);
      return "selected";
    }

    const trigger = find(LABEL_TRIGGER, true);
    if (!trigger || DANGER.test(label(trigger))) return false;
    return await applyLabel(trigger, true) ? "selected" : false;
  }

  const cardCandidate = () => [...document.querySelectorAll('.pack-card,.cursor-pointer,[class*="cursor-pointer"]')]
    .filter(el => visible(el) && !el.matches('button,a,input') && !el.closest('#wm-tri-panel'))
    .find(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 150 && rect.height > 80 && rect.width * rect.height < innerWidth * innerHeight * .7;
    });

  async function openCardDetails() {
    if (find(LABEL_TRIGGER) || hasTargetLabel()) return true;
    const card = await waitFor(cardCandidate, 4000);
    if (!card) return false;
    card.click();
    report("Détails de la carte ouverts");
    return !!await waitFor(() => find(LABEL_TRIGGER) || hasTargetLabel(), 2500);
  }

  async function closeCardDetails() {
    const close = controls().find(el => el.closest('[role="dialog"]') && (/fermer|close/.test(label(el)) || /^(x|×)$/.test(label(el))));
    if (close) {
      close.click();
      await sleep(200);
    }
  }

  async function processCollection() {
    const enter = await waitFor(() => find(/^selectionner$/, true), 5000);
    if (!enter) throw new Error("Bouton « Sélectionner » introuvable");
    enter.click();
    await sleep(300);

    for (let page = 0; page < 100; page++) {
      const cards = [...document.querySelectorAll('.relative.isolate.group')];
      if (!cards.length) throw new Error("Cartes de collection introuvables");

      const unlabelled = cards.filter(card => !card.querySelector('span.rounded-full'));
      for (const card of unlabelled) {
        const selector = card.querySelector('.cursor-pointer');
        if (!selector) throw new Error("Zone de sélection de carte introuvable");
        selector.click();
        await sleep(30);
      }

      if (unlabelled.length) {
        const tag = await waitFor(() => find(/^etiqueter$/, true), 2000);
        if (!tag) throw new Error("Bouton « Étiqueter » introuvable");
        tag.click();
        const option = await waitFor(targetOption, 2500);
        if (!option) throw new Error("Étiquette « à trier » introuvable");
        option.click();
        const completion = await waitFor(() => {
          const text = norm(document.body.innerText);
          const applied = text.match(/(\d+) cartes? etiquetees?/);
          const already = text.match(/(\d+) deja etiquetees?/);
          return applied || already ? Number(applied?.[1] || 0) + Number(already?.[1] || 0) : 0;
        }, 5000);
        if (completion < unlabelled.length) {
          throw new Error(`Confirmation incomplète: ${completion}/${unlabelled.length} carte(s) étiquetée(s)`);
        }
        const done = await waitFor(() => controls().find(el => /^termine$/.test(label(el))), 2000);
        if (!done) throw new Error("Bouton « Terminé » introuvable après l’étiquetage");
        done.click();
        await sleep(300);
        state.stats.cards += completion;
      }

      const next = controls().find(el => /^suivant/.test(norm(label(el))) && visible(el) && !el.disabled);
      if (!next) break;
      const first = cards[0];
      next.click();
      if (!await waitFor(() => document.querySelector('.relative.isolate.group') !== first, 5000)) {
        throw new Error("La page suivante de la collection ne charge pas");
      }
      await sleep(200);
    }

    report("Collection vérifiée");
  }

  async function processPack(packButton) {
    packButton.click();
    state.stats.packs++;
    report("Pack ouvert");
    await sleep(600);
    const deadline = Date.now() + 45000;

    while (state.running && Date.now() < deadline) {
      if (!await openCardDetails()) throw new Error("Pack ouvert, mais commande d’étiquette introuvable");
      const action = await labelOne();
      if (!action) throw new Error("Pack ouvert, mais commande d’étiquette introuvable");

      if (action === "selected" && !hasTargetLabel()) {
        if (!await openCardDetails()) throw new Error("Impossible de rouvrir la carte pour vérifier l’étiquette");
      }
      if (!await waitFor(hasTargetLabel, 2500)) throw new Error("Étiquette « à trier » non confirmée sur la carte");
      state.stats.cards++;
      report("Étiquette vérifiée");
      await closeCardDetails();

      const more = await waitFor(() => find(MORE_CARDS, true), 2000);
      if (more) {
        state.used.add(more);
        more.click();
        await sleep(300);
        continue;
      }

      const done = await waitFor(() => find(CONTINUE), 2000);
      if (!done) throw new Error("Pack étiqueté, mais bouton de fin introuvable");
      done.click();
      await sleep(600);
      return;
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
      if (COLLECTION) {
        await processCollection();
      } else {
        while (state.running) {
          const pack = await waitFor(() => find(PACK), state.stats.packs ? 2000 : 10000);
          if (!pack || DANGER.test(label(pack))) break;
          await processPack(pack);
        }
        if (state.running) report(state.stats.packs ? "Terminé" : "Aucun nouveau pack trouvé");
      }
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
