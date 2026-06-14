const REQUIRED_FIELDS = [
  "problem_to_control",
  "most_useful_part",
  "stuck_or_unsure",
  "missing_or_harder_than_expected",
  "paid_version_trigger",
];

const OPTIONAL_FIELDS = [
  "clarity_score",
  "usefulness_score",
  "trust_safety_score",
  "recommendation",
  "contact_email_optional",
];

const PRIVATE_DETAIL_MARKERS = [
  "passport",
  "driver licence",
  "drivers licence",
  "driver's licence",
  "account number",
  "credit card",
  "debit card",
  "password",
  "2fa",
  "two-factor",
  "tax file number",
  "ird number",
  "social security",
  "ssn",
  "policy number",
  "claim number",
  "bank statement",
  "birth certificate",
  "receipt attached",
  "see attached",
  "screenshot",
];

function textResponse(message, status = 200) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function normalise(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasPrivateDetailMarker(payload) {
  const haystack = Object.values(payload).join(" \n ").toLowerCase();
  return PRIVATE_DETAIL_MARKERS.find((marker) => haystack.includes(marker));
}

function scoreIsValid(value) {
  return value === "" || /^[1-5]$/.test(value);
}

function recommendationIsValid(value) {
  return value === "" || ["yes", "maybe", "no"].includes(value);
}

function emailIsValid(value) {
  return value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function buildFeedbackRecord(formData, now = new Date()) {
  const payload = {};

  for (const field of REQUIRED_FIELDS) {
    payload[field] = normalise(formData.get(field));
  }
  for (const field of OPTIONAL_FIELDS) {
    payload[field] = normalise(formData.get(field));
  }

  const missing = REQUIRED_FIELDS.filter((field) => payload[field].length < 2);
  if (missing.length) {
    return { ok: false, status: 400, message: `Missing required feedback field(s): ${missing.join(", ")}` };
  }

  for (const field of REQUIRED_FIELDS) {
    if (payload[field].length > 1200) {
      return { ok: false, status: 400, message: `${field} is too long. Please keep each answer under 1200 characters.` };
    }
  }

  if (!scoreIsValid(payload.clarity_score) || !scoreIsValid(payload.usefulness_score) || !scoreIsValid(payload.trust_safety_score)) {
    return { ok: false, status: 400, message: "Scores must be blank or a number from 1 to 5." };
  }

  if (!recommendationIsValid(payload.recommendation)) {
    return { ok: false, status: 400, message: "Recommendation must be blank, yes, maybe, or no." };
  }

  if (!emailIsValid(payload.contact_email_optional)) {
    return { ok: false, status: 400, message: "Optional contact email is not a valid email address." };
  }

  const privateMarker = hasPrivateDetailMarker(payload);
  if (privateMarker) {
    return {
      ok: false,
      status: 400,
      message: `Please remove private document/account details before submitting. Trigger word: ${privateMarker}`,
    };
  }

  return {
    ok: true,
    record: {
      kind: "home-admin-reset-kit-feedback",
      created_at: now.toISOString(),
      fields: payload,
    },
  };
}

export async function onRequestPost(context) {
  const request = context.request;
  const env = context.env || {};

  if (!env.FEEDBACK_KV || typeof env.FEEDBACK_KV.put !== "function") {
    return textResponse(
      "Feedback storage is not configured yet. This build/test form is prepared but not collecting live feedback.",
      503,
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch (error) {
    return textResponse("Could not read the submitted form data.", 400);
  }

  const result = buildFeedbackRecord(formData);
  if (!result.ok) {
    return textResponse(result.message, result.status);
  }

  const key = `feedback/${result.record.created_at}/${crypto.randomUUID()}.json`;
  await env.FEEDBACK_KV.put(key, JSON.stringify(result.record, null, 2), {
    metadata: {
      kind: result.record.kind,
      created_at: result.record.created_at,
    },
  });

  return textResponse("Thank you — feedback received. Please do not send any private documents.");
}

export function onRequestGet() {
  return textResponse("Feedback submissions must use POST.", 405);
}
