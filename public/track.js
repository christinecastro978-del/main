/*
 * CRM attribution snippet. Add to every page of your website:
 *   <script src="https://YOUR-CRM/t/track.js" defer></script>
 *
 * It remembers how each visitor arrived (UTM tags, ad click ids, referring
 * site) in their own browser, and when they submit a form with an email
 * field, sends the form and those touches to the CRM. Nothing is sent for
 * visitors who never submit a form.
 *
 * Options (attributes on the script tag):
 *   data-forms="tagged"  only capture forms marked <form data-crm>
 *                        (default: any form with an email field)
 * Also available: window.crmCapture({ email: '...', name: '...' }) for custom
 * widgets that don't use a <form>.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var endpoint = new URL(script.src).origin + '/t/submit';
  var taggedOnly = script.getAttribute('data-forms') === 'tagged';
  var KEY = 'crm_touches';
  var SESSION = 'crm_session_touch';
  var CLICK_IDS = ['gclid', 'msclkid', 'fbclid', 'li_fat_id', 'ttclid'];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-25))); } catch (e) { /* storage blocked */ }
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function currentTouch() {
    var params = new URLSearchParams(location.search);
    var touch = { at: new Date().toISOString(), landing: location.origin + location.pathname };
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
      var v = params.get('utm_' + k);
      if (v) touch[k] = v;
    });
    for (var i = 0; i < CLICK_IDS.length; i++) {
      if (params.get(CLICK_IDS[i])) { touch.click_id = CLICK_IDS[i]; break; }
    }
    var refHost = hostOf(document.referrer);
    if (refHost && refHost !== location.hostname.replace(/^www\./, '')) touch.referrer = document.referrer;
    return touch;
  }

  // Record this visit if it says something about how they arrived: campaign
  // tags, an ad click, an outside referrer, or their very first visit.
  var touch = currentTouch();
  var touches = load();
  var meaningful = touch.source || touch.click_id || touch.referrer;
  var signature = [touch.source, touch.medium, touch.campaign, touch.click_id, hostOf(touch.referrer)].join('|');
  var seen = null;
  try { seen = sessionStorage.getItem(SESSION); } catch (e) { /* ignore */ }
  if ((meaningful && seen !== signature) || !touches.length) {
    touches.push(touch);
    save(touches);
    try { sessionStorage.setItem(SESSION, signature); } catch (e) { /* ignore */ }
  }

  function send(fields) {
    var body = JSON.stringify({ fields: fields, touches: load(), page: currentTouch() });
    var sent = false;
    if (navigator.sendBeacon) {
      sent = navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }));
    }
    if (!sent) {
      fetch(endpoint, { method: 'POST', body: body, keepalive: true, mode: 'cors', headers: { 'Content-Type': 'text/plain' } })
        .catch(function () { /* never break the site's own form */ });
    }
  }

  window.crmCapture = function (fields) { send(fields || {}); };

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    if (form.hasAttribute('data-crm-ignore')) return;
    if (taggedOnly && !form.hasAttribute('data-crm')) return;
    var fields = {};
    var hasEmail = false;
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var name = el.name || el.id;
      if (!name || el.disabled || el.type === 'password' || el.type === 'file' || el.type === 'submit' || el.type === 'button') continue;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
      if (/card|cc-|cvc|cvv|ssn|password/i.test(name)) continue;
      if (el.type === 'email' || /e-?mail/i.test(name)) hasEmail = hasEmail || !!el.value;
      fields[name] = fields[name] ? fields[name] + ', ' + el.value : el.value;
    }
    if (hasEmail) send(fields);
  }, true);
})();
