// Subsidy Dropoff — interim front end.
//
// Binds to the /api/estimate contract in src/api/handler.ts. Every `unavailable`
// reason is rendered as its own designed state; nothing is ever filled in with a
// guessed number. Replaced by the v0 build (see design/v0-prompt.md) — the API
// contract does not change when it is.

const $ = (id) => document.getElementById(id);
const form = $("f");
const out = $("out");
const err = $("err");
const go = $("go");

const usd = (cents, opts = {}) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  }).format(cents / 100);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function notice(title, body, extra = "") {
  return `<div class="notice"><h3>${esc(title)}</h3><p>${body}</p>${extra}</div>`;
}

function renderUnavailable(u) {
  switch (u.reason) {
    case "ambiguous-zip": {
      const buttons = (u.candidateCounties ?? [])
        .map(
          (c) =>
            `<button class="choice" type="button" data-fips="${esc(c.fips)}">${esc(c.name)} County, ${esc(c.state)}</button>`,
        )
        .join("");
      return notice(
        "Which county?",
        "This ZIP code spans more than one county, and neighbouring counties can sit in different rating areas with different benchmark premiums. Pick yours and we'll give you an exact figure rather than an average.",
        `<div class="choices">${buttons}</div>`,
      );
    }
    case "state-based-exchange":
      return notice(
        `${esc(u.exchangeName ?? "Your state")} runs its own Marketplace`,
        `${esc(u.message)}`,
        u.exchangeUrl
          ? `<p><a href="${esc(u.exchangeUrl)}" rel="noopener">Continue to ${esc(u.exchangeName)}</a></p>`
          : "",
      );
    case "plan-year-not-published":
    case "dataset-not-loaded":
      return notice("Local premium unavailable", esc(u.message),
        '<p><a href="https://www.healthcare.gov/marketplace-in-your-state/">Find your Marketplace</a></p>');
    case "unknown-zip":
      return notice("We don't recognise that ZIP code", esc(u.message));
    default:
      return notice(
        "We don't have verified data for this yet",
        `${esc(u.message)} We would rather show you nothing than a number we can't stand behind &mdash; with the repayment caps repealed, a wrong estimate is now your liability, not ours.`,
      );
  }
}

function renderResult(d) {
  const r = d.result;
  const { ptc, cliff, csr, benchmark } = r;

  const over = ptc.ineligibilityReason === "income-above-400-percent";
  const tone = over ? "over" : cliff.cliffIsLive ? "live" : "";

  let headline;
  if (ptc.ineligibilityReason === "income-below-minimum") {
    headline = `<h3>Below the usual federal income range</h3><p>Your Marketplace can check Medicaid and any special eligibility rules that apply to your household.</p>`;
  } else if (over) {
    headline = `
      <p class="big">${usd(cliff.cliffCost, { cents: true })} a year.</p>
      <p>That is what you are currently giving up. Your income is
      ${usd(-cliff.headroom, { cents: true })} above the
      ${usd(cliff.cliffIncome)} cutoff, and above that line the credit is not
      reduced &mdash; it is zero. Deductible HSA, traditional IRA, SEP-IRA and solo
      401(k) contributions all reduce the income figure this test uses.</p>`;
  } else if (cliff.cliffIsLive) {
    headline = `
      <p class="big">${usd(cliff.headroom)} of headroom.</p>
      <p>You can take on that much more income before your subsidy disappears.
      Crossing ${usd(cliff.cliffIncome)} by a single cent costs you
      ${usd(cliff.cliffCost, { cents: true })} a year. Capital gains, Roth
      conversions and year-end bonuses all count toward it.</p>`;
  } else {
    headline = `
      <p class="big">You have no cliff.</p>
      <p>Your credit tapers to zero on its own at
      ${usd(cliff.subsidyExitIncome ?? 0, { cents: true })}, below the
      ${usd(cliff.cliffIncome)} threshold. There is nothing here to fall off, and
      holding your income down buys you nothing.</p>`;
  }

  const steps = [...ptc.workings, ...cliff.workings]
    .map(
      (w) => `<div class="step">
        <h3>${esc(w.label)}</h3>
        <p>${esc(w.detail)}</p>
        ${w.citation ? `<cite>${esc(w.citation)}</cite>` : ""}
      </div>`,
    )
    .join("");

  return `
    <div class="headline ${tone ? `headline--${tone}` : ""}">${headline}</div>
    <dl class="grid">
      <div class="cell"><dt>Benchmark plan</dt><dd>${usd(benchmark.monthlySlcsp)}<span class="hint">/mo</span></dd></div>
      <div class="cell"><dt>Benchmark after estimated credit</dt><dd>${usd(benchmark.monthlySlcsp - ptc.monthlyPtc, { cents: true })}<span class="hint">/mo</span></dd></div>
      <div class="cell"><dt>Estimated credit</dt><dd>${usd(ptc.monthlyPtc)}<span class="hint">/mo</span></dd></div>
      <div class="cell"><dt>% of poverty line</dt><dd>${ptc.fpl.form8962Percent > 400 ? "over 400" : ptc.fpl.form8962Percent}%</dd></div>
      <div class="cell"><dt>Your share of income</dt><dd>${(ptc.applicablePercentage / 100).toFixed(2)}%</dd></div>
      <div class="cell"><dt>Cost-sharing level</dt><dd>${esc(csr.variant.replace("csr-", "").replace("-", " "))}</dd></div>
    </dl>
    <details>
      <summary>Show the arithmetic</summary>
      ${steps}
    </details>`;
}

function renderProvenance(d) {
  const p = d.provenance ?? {};
  const t = p.applicablePercentageTable ?? {};
  const oe = p.openEnrollment ?? {};
  const bits = [];
  if (t.source) {
    bits.push(
      `Subsidy schedule: ${t.url ? `<a href="${esc(t.url)}" rel="noopener">${esc(t.source)}</a>` : esc(t.source)}${t.published ? `, published ${esc(t.published)}` : ""}.`,
    );
  }
  if (p.benchmarkSource) bits.push(`Premiums: ${esc(p.benchmarkSource)}.`);
  if (oe.endIsContested) {
    bits.push(
      `HealthCare.gov lists ${esc(oe.start)} through ${esc(oe.end)}. <a href="#oe">See coverage dates and the appeal status</a>.`,
    );
  }
  $("prov").innerHTML = bits.join(" ");
}

function renderIncomeCheck(data) {
  const range = `${usd(data.minimumIncome)} to ${usd(data.maximumIncome)}`;
  const lead = { within: "within", below: "below", above: "above" }[data.incomeStatus];
  const details = [];
  if (data.annualRequiredContribution !== null) {
    details.push(`The benchmark contribution in the federal formula is ${usd(data.annualRequiredContribution, { cents: true })} per year (${(data.applicablePercentage / 100).toFixed(2)}% of income).`);
  }
  if (data.estimatedMonthlyBenchmarkCredit !== null) {
    details.push(`Using the monthly benchmark you entered, the estimated credit toward that benchmark is ${usd(data.estimatedMonthlyBenchmarkCredit, { cents: true })} per month. Your enrolled plan’s qualifying premium can limit the actual credit.`);
  }
  if (data.incomeStatus === "below") details.push("This is below the usual income floor. Your Marketplace can check Medicaid and any special rules that apply.");
  if (data.incomeStatus === "above") details.push("The estimated federal premium tax credit is $0 above this ceiling.");
  return notice(`Your income is ${lead} the ${data.planYear} federal income range`,
    `For this household, the range is ${range}, including both endpoints. ${details.join(" ")}`);
}

async function submit(event) {
  event?.preventDefault();
  err.textContent = "";
  const incomeOnly = event?.submitter?.id === "check-limits";
  if (incomeOnly && (!$("region").value || !$("income").value.trim() || !$("householdSize").value.trim())) {
    err.textContent = "Choose your location and enter your household size and annual income.";
    out.replaceChildren();
    $("prov").replaceChildren();
    return;
  }
  $("check-limits").disabled = true;
  $("prov").replaceChildren();
  go.disabled = true;
  go.textContent = "Calculating…";

  const ages = $("ages")
    .value.split(",")
    .map((a) => Number(a.trim()))
    .filter((a) => Number.isFinite(a));

  const body = {
    planYear: Number($("planYear").value),
    zip: $("zip").value.trim(),
    householdSize: Number($("householdSize").value),
    income: Number($("income").value),
    ages,
    countyFips: $("countyFips").value || undefined,
  };

  try {
    const incomeBody = {
      planYear: body.planYear, region: $("region").value, income: body.income, householdSize: body.householdSize,
      ...($("monthlyBenchmark").value ? { monthlyBenchmark: Number($("monthlyBenchmark").value) } : {}),
    };
    const response = await fetch(incomeOnly ? "/api/income-check" : "/api/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(incomeOnly ? incomeBody : body),
    });
    const data = await response.json();

    if (data.error === "validation_failed") {
      err.textContent = data.problems.map((p) => `${p.field}: ${p.message}`).join(" · ");
      out.innerHTML = "";
    } else if (data.ok && incomeOnly) {
      out.innerHTML = renderIncomeCheck(data);
    } else if (data.ok) {
      out.innerHTML = renderResult(data);
      renderProvenance(data);
    } else if (data.unavailable) {
      out.innerHTML = renderUnavailable(data.unavailable);
      if (data.unavailable.reason === "dataset-not-loaded") $("income-check").open = true;
      renderProvenance(data);
    } else {
      err.textContent = data.message ?? "Something went wrong.";
      out.innerHTML = "";
    }
  } catch (error) {
    err.textContent = `Could not reach the estimator: ${error.message}`;
  } finally {
    $("check-limits").disabled = false;
    go.disabled = false;
    go.textContent = "Find my dropoff point";
  }
}

form.addEventListener("submit", submit);

// County disambiguation: re-run the estimate pinned to the chosen county.
out.addEventListener("click", (event) => {
  const button = event.target.closest("[data-fips]");
  if (!button) return;
  $("countyFips").value = button.dataset.fips;
  void submit();
});

// A fresh ZIP invalidates any previously chosen county.
$("zip").addEventListener("input", () => {
  $("countyFips").value = "";
});
