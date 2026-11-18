// YAML resource mode is read-only. Wait for HA's registry before registering the card.
const card = new URL('./pv-manager-card.js', import.meta.url);
card.search = new URL(import.meta.url).search;
const deadline = Date.now() + 30000;

function loadCard() {
  if (customElements.get('home-assistant')) {
    import(card.href).catch(error => console.error('PV Manager could not load its dashboard card:', error));
  } else if (Date.now() < deadline) {
    setTimeout(loadCard, 25);
  }
}

loadCard();
