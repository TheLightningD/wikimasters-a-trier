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
  const CONTINUE = /continuer|terminer|suivant|ajouter.*collection|collectionner|conserver/;
  const MORE_CARDS = /encore \d+ carte/;
  const DANGER = /acheter|paiement|vendre|supprimer|echanger/;
  const DAILY_LIMIT = /limite quotidienne de paquets atteinte/;
  const MODE = document.documentElement.dataset.wmMode;
  const COLLECTION = MODE === "collection";
  const CLEANUP = MODE === "cleanup";
  const INVENTORY_COUNT = MODE === "inventory-count";
  const INVENTORY = MODE === "inventory";
  const WISHLIST_APPLY = MODE === "wishlist-apply";
  const SOURCE_LABEL = "#osef";

  const state = window.__WM_TRI__ = {
    running: false,
    used: new WeakSet(),
    stats: { packs: 0, cards: 0 },
    inventory: [],
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
  const progress = (phase, processed, total, title = "") => {
    statusEl.textContent = `${phase} · ${processed}/${total}${title ? ` · ${title}` : ""}`;
    console.log(`__WM_PROGRESS__${JSON.stringify({ phase, processed, total, title })}`);
  };
  const setRunning = running => {
    state.running = running;
    startEl.hidden = running;
    stopEl.hidden = !running;
  };

  const optionNamed = name => controls().find(el => el.matches('button,[role="button"]') && label(el) === norm(name));
  const removalNamed = name => controls().find(el => {
    const aria = norm(el.getAttribute('aria-label'));
    return /retirer.*etiquette/.test(aria) && (norm(el.innerText) === norm(name) || aria.endsWith(norm(name)));
  });
  const detailLabels = () => controls().map(el => el.getAttribute('aria-label') || '')
    .filter(value => /^retirer l['’]étiquette\s+/i.test(value))
    .map(value => value.replace(/^retirer l['’]étiquette\s+/i, '').trim());
  const targetOption = () => optionNamed("à trier");
  const targetRemoval = () => removalNamed("à trier");
  const hasTargetLabel = () => !!targetRemoval();
  const rawCardLabels = card => [...card.querySelectorAll('span.rounded-full')].map(item => item.textContent.trim()).filter(Boolean);
  const cardLabels = card => rawCardLabels(card).map(norm);
  const cardTitle = card => card.querySelector('strong,h2,h3')?.textContent.trim()
    || card.querySelector('img[alt]:not([alt=""])')?.alt.trim()
    || card.innerText.trim().split("\n")[0];
  const cardIdentity = card => {
    const articleUrl = card.querySelector('a[href*="wikipedia.org"]')?.href || "";
    const title = cardTitle(card);
    return articleUrl ? `article:${articleUrl}` : title ? `title:${norm(title)}` : "";
  };
  const cardPhysicalIdentity = card => {
    if (card.dataset.physicalId) return card.dataset.physicalId;
    // ponytail: WikiMasters n'expose l'id physique que dans les props React; préférer un attribut data-* s'il apparaît.
    const key = Object.keys(card).find(name => name.startsWith('__reactProps$'));
    const children = card[key]?.children;
    const id = (Array.isArray(children) ? children : [children]).find(child => child?.props?.card?.id)?.props.card.id;
    return id ? `card:${id}` : cardIdentity(card);
  };
  const collectionCards = () => [...document.querySelectorAll('.relative.isolate.group')];
  const waitForCollectionCards = () => waitFor(() => collectionCards().length ? collectionCards() : null, 10000);
  const pageSignature = cards => cards.map(cardPhysicalIdentity).filter(Boolean).join("\n");
  const rememberPage = (cards, seen) => {
    const signature = pageSignature(cards);
    if (seen.has(signature)) throw new Error("Pagination cyclique détectée");
    seen.add(signature);
  };
  const nextCollectionPage = async cards => {
    const nextButtons = controls().filter(el => /^suivant/.test(label(el)) && !el.disabled);
    if (!nextButtons.length) return false;
    const before = pageSignature(cards);
    for (const next of nextButtons) {
      next.click();
      if (await waitFor(() => {
        const current = collectionCards();
        return current.length && pageSignature(current) !== before;
      }, 2500)) {
        await sleep(200);
        return true;
      }
      if (next.disabled || !visible(next)) return false;
    }
    throw new Error("La page suivante de la collection ne charge pas");
  };

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
    const close = controls().find(el => /fermer|close/.test(label(el)) || /^(x|×)$/.test(label(el)));
    if (close) {
      close.click();
      await sleep(200);
    }
  }

  async function processCollection() {
    for (let page = 0; page < 100; page++) {
      const cards = await waitForCollectionCards();
      if (!cards?.length) throw new Error("Cartes de collection introuvables");

      const unlabelled = cards.filter(card => !card.querySelector('span.rounded-full'));
      if (unlabelled.length) {
        const indexes = unlabelled.map(card => cards.indexOf(card));
        const enter = await waitFor(() => find(/^selectionner$/, true), 5000);
        if (!enter) throw new Error("Bouton « Sélectionner » introuvable");
        enter.click();
        if (!await waitFor(() => find(/^quitter la selection$/), 3000)) {
          throw new Error("Le mode de sélection ne s'active pas");
        }
        const selectableCards = await waitForCollectionCards();
        for (const index of indexes) {
          const card = selectableCards[index];
          const selector = card.querySelector('.cursor-pointer');
          if (!selector) throw new Error("Zone de sélection de carte introuvable");
          selector.click();
          await sleep(30);
        }

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

        const leave = await waitFor(() => find(/^quitter la selection$/), 1000);
        if (leave) {
          leave.click();
          if (!await waitFor(() => find(/^selectionner$/), 3000)) throw new Error("Le mode de sélection ne se ferme pas");
        }
      }

      if (!await nextCollectionPage(cards)) break;
    }

    report("Collection vérifiée");
  }

  async function processCleanup() {
    for (let page = 0; page < 100; page++) {
      const cards = await waitForCollectionCards();
      if (!cards?.length) throw new Error("Cartes de collection introuvables");

      for (let index = 0; index < cards.length; index++) {
        const labels = cardLabels(cards[index]);
        const others = labels.filter(value => value !== "a trier");
        if (!labels.includes("a trier") || !others.length) continue;

        const selector = cards[index].querySelector('.cursor-pointer');
        if (!selector) throw new Error("Zone d'ouverture de carte introuvable");
        selector.click();
        const remove = await waitFor(targetRemoval, 2500);
        if (!remove) throw new Error("Commande de retrait « à trier » introuvable");
        remove.click();
        await sleep(300);
        await closeCardDetails();

        const confirmed = await waitFor(() => {
          const current = [...document.querySelectorAll('.relative.isolate.group')][index];
          const currentLabels = current ? cardLabels(current) : [];
          return !currentLabels.includes("a trier") && others.every(value => currentLabels.includes(value));
        }, 2500);
        if (!confirmed) throw new Error("Retrait « à trier » non confirmé ou autre étiquette modifiée");
        state.stats.cards++;
        report("Étiquette « à trier » retirée");
      }

      if (!await nextCollectionPage(cards)) break;
    }
    report("Nettoyage terminé");
  }

  async function processInventoryCount() {
    let total = 0;
    const inventory = new Map();
    const physicalIds = new Set();
    const pages = new Set();
    for (;;) {
      const cards = await waitForCollectionCards();
      if (!cards?.length) throw new Error("Cartes de collection introuvables");
      await waitFor(() => cards.some(card => card.querySelector('.rounded-full')), 15000);
      rememberPage(cards, pages);
      for (const card of cards.filter(item => cardLabels(item).includes(SOURCE_LABEL))) {
        const physicalId = cardPhysicalIdentity(card);
        if (!physicalId) throw new Error("Identité physique d'une carte « #Osef » introuvable");
        if (physicalIds.has(physicalId)) continue;
        physicalIds.add(physicalId);
        total++;
        const id = cardIdentity(card);
        if (!id) throw new Error("Identité d'une carte « #Osef » introuvable");
        const known = inventory.get(id);
        inventory.set(id, { id, title: cardTitle(card), copies: (known?.copies || 0) + 1 });
      }
      if (!await nextCollectionPage(cards)) break;
    }
    state.inventory = [...inventory.values()];
    state.physicalIds = [...physicalIds];
    state.stats.cards = total;
    report("Comptage osef terminé");
  }

  async function processInventory() {
    const inventory = new Map();
    const physicalIds = new Set();
    const skipped = new Set(window.__WM_WISHLIST_PLAN__?.skipIds || []);
    const pages = new Set();
    let total = Number(window.__WM_WISHLIST_PLAN__?.totalCards) || 0;
    let processed = 0;
    for (;;) {
      const cards = await waitForCollectionCards();
      if (!cards?.length) throw new Error("Cartes de collection introuvables");
      rememberPage(cards, pages);
      for (const card of cards.filter(item => cardLabels(item).includes(SOURCE_LABEL))) {
        const physicalId = cardPhysicalIdentity(card);
        if (!physicalId) throw new Error("Identité physique d'une carte « #Osef » introuvable");
        if (physicalIds.has(physicalId)) continue;
        physicalIds.add(physicalId);
        const title = cardTitle(card);
        if (!title) throw new Error("Titre d'une carte « #Osef » introuvable");
        const articleUrl = card.querySelector('a[href*="wikipedia.org"]')?.href || "";
        const id = articleUrl ? `article:${articleUrl}` : `title:${norm(title)}`;
        processed++;
        if (processed > total) total = processed;
        if (skipped.has(id) || inventory.has(id)) {
          progress("Inventaire", processed, total, title);
          continue;
        }
        const selector = card.querySelector('.cursor-pointer');
        if (!selector) throw new Error("Zone d'ouverture de carte introuvable pour l'inventaire");
        selector.click();
        const exactLabels = await waitFor(() => {
          const values = detailLabels();
          return values.some(value => norm(value) === SOURCE_LABEL) ? values : null;
        }, 3000);
        if (!exactLabels) throw new Error(`Étiquettes détaillées introuvables pour « ${title} »`);
        inventory.set(id, {
          id,
          title,
          articleUrl,
          labels: exactLabels,
          text: card.innerText.trim(),
          imageAlt: [...card.querySelectorAll('img[alt]:not([alt=""])')].map(image => image.alt.trim()).filter(Boolean).join(" ")
        });
        await closeCardDetails();
        progress("Inventaire", processed, total, title);
      }
      if (!await nextCollectionPage(cards)) break;
    }
    state.inventory = [...inventory.values()];
    state.physicalIds = [...physicalIds];
    state.stats.cards = state.inventory.length;
    report("Inventaire osef terminé");
  }

  async function leaveSelection() {
    const leave = await waitFor(() => find(/^quitter la selection$/), 1000);
    if (!leave) return;
    leave.click();
    if (!await waitFor(() => find(/^selectionner$/), 3000)) throw new Error("Le mode de sélection ne se ferme pas");
  }

  async function addManagedLabel(physicalIds, name) {
    if (!name.startsWith("échange · ")) throw new Error(`Étiquette non gérée refusée: ${name}`);
    const enter = await waitFor(() => find(/^selectionner$/, true), 5000);
    if (!enter) throw new Error("Bouton « Sélectionner » introuvable");
    enter.click();
    if (!await waitFor(() => find(/^quitter la selection$/), 3000)) throw new Error("Le mode de sélection ne s'active pas");
    const selectable = await waitForCollectionCards();
    const remaining = [...physicalIds];
    const indexes = selectable.map((card, index) => {
      const match = remaining.indexOf(cardPhysicalIdentity(card));
      if (match < 0) return -1;
      remaining.splice(match, 1);
      return index;
    }).filter(index => index >= 0);
    if (remaining.length) throw new Error("Carte planifiée introuvable après activation de la sélection");
    for (const index of indexes) {
      if (!cardLabels(selectable[index]).includes(SOURCE_LABEL)) throw new Error("Carte sans étiquette « #Osef » refusée");
      const selector = selectable[index].querySelector('.cursor-pointer');
      if (!selector) throw new Error("Zone de sélection de carte introuvable");
      selector.click();
      await sleep(30);
    }
    const tag = await waitFor(() => find(/^etiqueter$/, true), 2000);
    if (!tag) throw new Error("Bouton « Étiqueter » introuvable");
    tag.click();
    let option = await waitFor(() => optionNamed(name), 1200);
    if (!option) {
      const input = await waitFor(() => controls().find(el => el.matches('input') && /chercher.*creer.*etiquette/.test(label(el))), 2000);
      if (!input) throw new Error(`Création de l'étiquette « ${name} » introuvable`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, name);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: name }));
      option = await waitFor(() => controls().find(el => /^creer/.test(label(el)) && label(el).includes(norm(name))), 2000);
      if (!option) throw new Error(`Commande de création « ${name} » introuvable`);
    }
    option.click();
    const completion = await waitFor(() => {
      const text = norm(document.body.innerText);
      const applied = text.match(/(\d+) cartes? etiquetees?/);
      const already = text.match(/(\d+) deja etiquetees?/);
      return applied || already ? { applied: Number(applied?.[1] || 0), already: Number(already?.[1] || 0) } : null;
    }, 5000);
    if (!completion || completion.applied + completion.already < indexes.length) throw new Error(`Confirmation incomplète pour « ${name} »: ${(completion?.applied || 0) + (completion?.already || 0)}/${indexes.length}`);
    const done = await waitFor(() => controls().find(el => /^termine$/.test(label(el))), 2000);
    if (!done) throw new Error(`Bouton « Terminé » introuvable pour « ${name} »`);
    done.click();
    await sleep(200);
    await leaveSelection();
    // ponytail: les badges de collection restent obsolètes; le compteur serveur est la confirmation fiable.
    state.stats.additions += completion.applied;
  }

  async function processWishlistApply() {
    const plan = window.__WM_WISHLIST_PLAN__ || { additions: [], removals: [] };
    let total = Number(plan.totalCards) || 0;
    state.stats.additions = 0;
    state.stats.removals = 0;
    const seen = new Set();
    const seenPhysical = new Set();
    const skipped = new Set(plan.skipIds || []);
    const handledPlans = new Set();
    const handledPlanCards = new WeakSet();
    const handledCards = new Set();
    const pages = new Set();
    const failures = [];
    let processed = 0;
    for (;;) {
      const cards = await waitForCollectionCards();
      if (!cards?.length) throw new Error("Cartes de collection introuvables");
      rememberPage(cards, pages);
      const ids = cards.map(cardIdentity);
      const physicalIds = cards.map(cardPhysicalIdentity);
      const eligible = ids.map((id, index) => {
        if (!cardLabels(cards[index]).includes(SOURCE_LABEL)) return false;
        return !skipped.has(physicalIds[index]);
      });
      const additions = plan.additions.filter(item => ids.includes(item.cardId));
      for (const name of [...new Set(additions.flatMap(item => item.labels))]) {
        const indexes = ids.map((id, index) => eligible[index] && !handledCards.has(physicalIds[index]) && additions.some(item => item.cardId === id && item.labels.includes(name)) ? index : -1).filter(index => index >= 0);
        if (!indexes.length) continue;
        indexes.forEach(index => seen.add(ids[index]));
        await addManagedLabel(indexes.map(index => physicalIds[index]), name);
        indexes.forEach(index => {
          if (handledPlanCards.has(cards[index])) return;
          handledPlanCards.add(cards[index]);
          handledPlans.add(physicalIds[index]);
        });
      }
      for (const item of plan.removals.filter(entry => ids.includes(entry.cardId))) {
        for (const index of ids.map((id, index) => id === item.cardId && eligible[index] && !handledCards.has(physicalIds[index]) ? index : -1).filter(index => index >= 0)) {
          seen.add(item.cardId);
          if (!cardLabels(cards[index]).includes(SOURCE_LABEL)) throw new Error("Carte sans étiquette « #Osef » refusée");
          cards[index].querySelector('.cursor-pointer')?.click();
          const before = await waitFor(() => {
            const values = detailLabels();
            return values.some(value => norm(value) === SOURCE_LABEL) ? values : null;
          }, 3000);
          if (!before) throw new Error("Étiquettes détaillées introuvables avant retrait");
          const removed = new Set();
          for (const name of item.labels) {
            if (!name.startsWith("échange · ")) throw new Error(`Retrait non géré refusé: ${name}`);
            if (!before.some(value => norm(value) === norm(name))) continue;
            let confirmed = false;
            for (let attempt = 1; attempt <= 3 && !confirmed; attempt++) {
              const remove = await waitFor(() => removalNamed(name), 5000);
              if (!remove) {
                const current = detailLabels();
                confirmed = current.some(value => norm(value) === SOURCE_LABEL) && !current.some(value => norm(value) === norm(name));
                break;
              }
              remove.click();
              confirmed = !!await waitFor(() => !detailLabels().some(value => norm(value) === norm(name)), 15000);
              if (!confirmed) {
                await closeCardDetails();
                cards[index].querySelector('.cursor-pointer')?.click();
                const refreshed = await waitFor(() => {
                  const values = detailLabels();
                  return values.some(value => norm(value) === SOURCE_LABEL) ? values : null;
                }, 5000);
                confirmed = !!refreshed && !refreshed.some(value => norm(value) === norm(name));
              }
              if (!confirmed) report(`Nouvelle tentative de retrait « ${name} » (${attempt}/3)`);
            }
            if (confirmed) {
              removed.add(name);
              state.stats.removals++;
            } else {
              failures.push(`Retrait « ${name} » non confirmé`);
            }
          }
          const expected = before.filter(name => !removed.has(name));
          const after = detailLabels().map(norm);
          if (!expected.every(name => after.includes(norm(name)))) throw new Error("Une étiquette non gérée a été modifiée");
          await closeCardDetails();
          if (!handledPlanCards.has(cards[index])) {
            handledPlanCards.add(cards[index]);
            handledPlans.add(physicalIds[index]);
          }
        }
      }
      for (const card of cards.filter(item => cardLabels(item).includes(SOURCE_LABEL))) {
        const id = cardIdentity(card);
        if (!id) throw new Error("Identité d'une carte « #Osef » introuvable pendant l'application");
        const physicalId = cardPhysicalIdentity(card);
        if (!physicalId) throw new Error("Identité physique d'une carte « #Osef » introuvable pendant l'application");
        if (seenPhysical.has(physicalId)) continue;
        seen.add(id);
        seenPhysical.add(physicalId);
        processed = seenPhysical.size;
        if (processed > total) total = processed;
        progress("Application", processed, total, cardTitle(card));
      }
      physicalIds.forEach(id => handledCards.add(id));
      if (!await nextCollectionPage(cards)) break;
    }
    state.inventory = [...seen].map(id => ({ id }));
    state.physicalIds = [...seenPhysical];
    state.handledIds = [...handledPlans];
    state.stats.cards = processed;
    if (failures.length) throw new Error(`${failures.length} retrait(s) non confirmé(s) après ${processed}/${total} cartes: ${failures.join("; ")}`);
    report("Souhaits synchronisés");
  }

  async function processPack(packButton) {
    packButton.click();
    await sleep(600);
    if (DAILY_LIMIT.test(norm(document.body.innerText))) {
      report("Limite quotidienne de paquets atteinte");
      return false;
    }
    const deadline = Date.now() + 45000;
    let opened = false;

    while (state.running && Date.now() < deadline) {
      if (!await openCardDetails()) {
        if (DAILY_LIMIT.test(norm(document.body.innerText))) {
          report("Limite quotidienne de paquets atteinte");
          return false;
        }
        throw new Error("Pack ouvert, mais commande d’étiquette introuvable");
      }
      if (!opened) {
        state.stats.packs++;
        report("Pack ouvert");
        opened = true;
      }
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

      const nextCard = [...document.querySelectorAll('button')].find(el => visible(el) && el.querySelector('polyline[points="9 18 15 12 9 6"]'));
      if (nextCard) {
        nextCard.click();
        await sleep(300);
        continue;
      }

      const done = await waitFor(() => find(CONTINUE), 2000);
      if (!done) throw new Error("Pack étiqueté, mais bouton de fin introuvable");
      done.click();
      await sleep(600);
      return true;
    }
    if (state.running) throw new Error("Délai dépassé pendant le traitement du pack");
  }

  async function run() {
    if (state.running) return;
    state.stats = { packs: 0, cards: 0 };
    state.inventory = [];
    state.logs.length = 0;
    state.used = new WeakSet();
    setRunning(true);
    try {
      if (COLLECTION) {
        await processCollection();
      } else if (CLEANUP) {
        await processCleanup();
      } else if (INVENTORY_COUNT) {
        await processInventoryCount();
      } else if (INVENTORY) {
        await processInventory();
      } else if (WISHLIST_APPLY) {
        await processWishlistApply();
      } else {
        while (state.running) {
          const pack = await waitFor(() => find(PACK), state.stats.packs ? 2000 : 10000);
          if (!pack || DANGER.test(label(pack))) break;
          if (!await processPack(pack)) break;
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
