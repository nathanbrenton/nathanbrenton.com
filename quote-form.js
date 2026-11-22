// Quote request form (/contact/): checks the fields, shows problems next to them, and sends
// the form without leaving the page. Without JavaScript the form still posts normally and
// the server (deploy/form/nb_form.py) checks everything again.
(function () {
  "use strict";
  var form = document.getElementById("quote-form");
  if (!form || !window.fetch || !window.URLSearchParams) return;

  var CONTACT_EMAIL = "info@nathanbrenton.com";
  var started = Date.now();
  var submitted = false;

  function el(name) { return form.elements[name]; }
  function phoneDigits(v) {
    var d = v.replace(/\D/g, "");
    if (d.length === 11 && d.charAt(0) === "1") d = d.slice(1);
    return d;
  }
  function contactBy() {
    var c = form.querySelector('input[name="contact_by"]:checked');
    return c ? c.value : "email";
  }

  // Same rules as the server.
  var rules = {
    name: function (v) { return v.trim() ? "" : "Please enter your name."; },
    email: function (v) {
      v = v.trim();
      if (!v) return "Please enter your email address.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "Please check your email address.";
    },
    phone: function (v) {
      v = v.trim();
      if (!v) return contactBy() === "email" ? "" : "Please enter a phone number, or choose Email.";
      return phoneDigits(v).length >= 7 ? "" : "Please check your phone number.";
    },
    details: function (v) { return v.trim().length >= 10 ? "" : "Please tell me a little about the job."; }
  };

  function showError(name, message) {
    var input = el(name);
    var box = document.getElementById("err-" + name);
    if (message) {
      input.setAttribute("aria-invalid", "true");
      box.textContent = message;
      box.hidden = false;
    } else {
      input.removeAttribute("aria-invalid");
      box.textContent = "";
      box.hidden = true;
    }
  }
  function check(name) {
    var message = rules[name](el(name).value);
    showError(name, message);
    return message;
  }

  // Point out a problem when someone leaves a field they've filled in (or after a first
  // attempt to send), and clear it as soon as it's fixed.
  Object.keys(rules).forEach(function (name) {
    var input = el(name);
    input.addEventListener("blur", function () {
      if (submitted || input.value.trim()) check(name);
    });
    input.addEventListener("input", function () {
      if (input.getAttribute("aria-invalid") === "true" && !rules[name](input.value)) showError(name, "");
    });
  });
  Array.prototype.forEach.call(form.querySelectorAll('input[name="contact_by"]'), function (r) {
    r.addEventListener("change", function () { if (submitted || el("phone").value) check("phone"); });
  });

  var button = form.querySelector('button[type="submit"]');
  var status = form.querySelector(".form-status");
  function setStatus(message, kind) {
    status.textContent = message;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-ok", kind === "ok");
  }

  function done(firstName) {
    var box = document.createElement("div");
    box.className = "form-done";
    box.setAttribute("tabindex", "-1");
    box.setAttribute("role", "status");
    box.innerHTML = "<h2></h2><p></p>";
    box.children[0].textContent = "Thank you" + (firstName ? ", " + firstName : "") + "!";
    box.children[1].textContent = "Your request has been sent. I'll reply soon, usually within one business day.";
    form.parentNode.replaceChild(box, form);
    box.focus();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (button.disabled) return;
    submitted = true;

    var firstBad = null;
    Object.keys(rules).forEach(function (name) {
      if (check(name) && !firstBad) firstBad = el(name);
    });
    if (firstBad) {
      setStatus("Please check the highlighted fields.", "error");
      firstBad.focus();
      return;
    }

    el("t").value = String(Math.round((Date.now() - started) / 1000));
    button.disabled = true;
    var label = button.textContent;
    button.textContent = "Sending…";
    setStatus("", "");

    fetch(form.action, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: new URLSearchParams(new FormData(form))
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, status: r.status }; });
    }).then(function (data) {
      if (data.ok) {
        done(el("name").value.trim().split(/\s+/)[0]);
        return;
      }
      button.disabled = false;
      button.textContent = label;
      if (data.fields) {
        var first = null;
        Object.keys(data.fields).forEach(function (name) {
          if (document.getElementById("err-" + name)) {
            showError(name, data.fields[name]);
            if (!first) first = el(name);
          }
        });
        setStatus("Please check the highlighted fields.", "error");
        if (first) first.focus();
      } else if (data.status === 429) {
        setStatus("Too many tries in a row. Please wait a minute and send again.", "error");
      } else {
        setStatus("Sorry, that didn't go through. Please try again, or email " + CONTACT_EMAIL +
          ". What you typed is still here.", "error");
      }
    }).catch(function () {
      button.disabled = false;
      button.textContent = label;
      setStatus("Couldn't reach the server. Check your connection and try again, or email " +
        CONTACT_EMAIL + ".", "error");
    });
  });
})();
