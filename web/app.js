(function () {
  "use strict";

  var VL = window.CredentialLens;
  var SAMPLES = window.CredentialLensSamples.samples;

  var $ = function (id) { return document.getElementById(id); };

  var input = $("input");
  var results = $("results");
  var status = $("status");
  var activeSample = null;

  var SEVERITY = {
    error: { label: "Error", rank: 0 },
    warning: { label: "Warning", rank: 1 },
    info: { label: "Info", rank: 2 },
  };

  var BAND_COLOR = {
    strong: "#3fb950",
    acceptable: "#58a6ff",
    weak: "#d29922",
    poor: "#f85149",
  };

  /* ------------------------------------------------------------- samples UI */

  function buildSampleButtons() {
    var box = $("sampleBtns");
    Object.keys(SAMPLES).forEach(function (name) {
      var btn = document.createElement("button");
      btn.className = "chip-btn";
      btn.type = "button";
      btn.textContent = name;
      btn.title = SAMPLES[name].label;
      btn.dataset.sample = name;
      btn.addEventListener("click", function () {
        loadSample(name);
      });
      box.appendChild(btn);
    });
  }

  function markActive(name) {
    activeSample = name;
    var all = document.querySelectorAll(".chip-btn");
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle("on", all[i].dataset.sample === name);
    }
  }

  function loadSample(name) {
    var sample = SAMPLES[name];
    input.value = JSON.stringify(sample.credential, null, 2);
    markActive(name);
    setStatus("");
    run();
  }

  /* ---------------------------------------------------------------- status */

  function setStatus(text, isError) {
    status.textContent = text || "";
    status.classList.toggle("err", !!isError);
  }

  /* ----------------------------------------------------------------- render */

  function render(result) {
    results.hidden = false;

    $("score").textContent = result.score;
    $("band").textContent = result.band;
    $("verdict").textContent = result.valid
      ? "This credential is well formed"
      : "This credential is not valid";
    $("verdict").className = "verdict " + (result.valid ? "good" : "bad");

    var c = result.counts;
    $("counts").innerHTML =
      '<span class="e">' + c.error + " error</span> · " +
      '<span class="w">' + c.warning + " warning</span> · " +
      '<span class="i">' + c.info + " info</span>";

    var fill = $("gaugeFill");
    var circumference = 2 * Math.PI * 52;
    var color = BAND_COLOR[result.band] || "#58a6ff";
    fill.style.stroke = color;
    fill.style.strokeDasharray = circumference;
    fill.style.strokeDashoffset = circumference;
    // Force a reflow so the transition always replays on re-validation.
    void fill.getBoundingClientRect();
    fill.style.strokeDashoffset = circumference * (1 - result.score / 100);

    renderFindings(result.findings);
    $("tree").textContent = JSON.stringify(result.credential, null, 2);
  }

  function renderFindings(findings) {
    var box = $("findings");
    box.innerHTML = "";

    if (findings.length === 0) {
      var clean = document.createElement("div");
      clean.className = "finding";
      clean.innerHTML = "<p>No findings. Every check passed.</p>";
      box.appendChild(clean);
      return;
    }

    var sorted = findings.slice().sort(function (a, b) {
      var d = SEVERITY[a.severity].rank - SEVERITY[b.severity].rank;
      return d !== 0 ? d : a.pointer.localeCompare(b.pointer);
    });

    var lastSeverity = null;
    sorted.forEach(function (f) {
      if (f.severity !== lastSeverity) {
        lastSeverity = f.severity;
        var head = document.createElement("div");
        head.className = "group-head";
        head.textContent = SEVERITY[f.severity].label + "s";
        box.appendChild(head);
      }

      var el = document.createElement("div");
      el.className = "finding " + f.severity;

      var top = document.createElement("div");
      top.className = "f-top";

      var sev = document.createElement("span");
      sev.className = "sev";
      sev.textContent = SEVERITY[f.severity].label;
      top.appendChild(sev);

      var code = document.createElement("span");
      code.className = "code";
      code.textContent = f.code;
      top.appendChild(code);

      var ptr = document.createElement("span");
      ptr.className = "ptr";
      ptr.textContent = f.pointer;
      top.appendChild(ptr);

      el.appendChild(top);

      var msg = document.createElement("p");
      msg.textContent = f.message;
      el.appendChild(msg);

      if (f.hint) {
        var hint = document.createElement("p");
        hint.className = "fix";
        hint.textContent = f.hint;
        el.appendChild(hint);
      }

      box.appendChild(el);
    });
  }

  /* -------------------------------------------------------------------- run */

  function run() {
    var text = input.value.trim();
    if (!text) {
      results.hidden = true;
      setStatus("Paste a credential first", true);
      return;
    }

    var parsed = VL.parse(text);
    if (!parsed.ok) {
      results.hidden = true;
      setStatus("Not valid JSON: " + parsed.error, true);
      return;
    }

    setStatus("");
    render(VL.validate(parsed.value));
  }

  /* ------------------------------------------------------------------ input */

  function loadFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      input.value = String(reader.result || "");
      markActive(null);
      run();
    };
    reader.onerror = function () {
      setStatus("Could not read that file", true);
    };
    reader.readAsText(file);
  }

  function wire() {
    $("run").addEventListener("click", run);

    $("clear").addEventListener("click", function () {
      input.value = "";
      results.hidden = true;
      markActive(null);
      setStatus("");
      input.focus();
    });

    $("file").addEventListener("change", function (e) {
      loadFile(e.target.files && e.target.files[0]);
    });

    var drop = $("drop");
    ["dragenter", "dragover"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.remove("over");
      });
    });
    drop.addEventListener("drop", function (e) {
      loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    });

    input.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        markActive(null);
        run();
      }
    });

    $("copyBtn").addEventListener("click", function () {
      var text = $("tree").textContent;
      if (!text) return;
      var btn = this;
      var done = function () {
        var original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = original; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  }

  buildSampleButtons();
  wire();
  loadSample("well-formed");
})();