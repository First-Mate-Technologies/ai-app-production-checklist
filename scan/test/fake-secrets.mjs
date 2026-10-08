// Fake secrets for tests. Nothing here is a real credential, and nothing here is a
// complete key-shaped string: each one is assembled at runtime from fragments, so no
// secret scanner (GitHub push protection included) sees a key in the committed source.

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function jwt(role) {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({ iss: "supabase", ref: "fakefakefakefake", role, iat: 1, exp: 2 });
  return `${header}.${payload}.${["Zq8L", "m2Vx", "9Tb4", "Nc7H", "d3Kp", "5Rw1", "Yj6G", "sE0u"].join("")}`;
}

const tail = (n) => ["Zq8L", "m2Vx", "9Tb4", "Nc7H", "d3Kp", "5Rw1", "Yj6G", "sE0u"].join("").slice(0, n);

export const FAKES = {
  SK_LIVE: ["sk", "live", tail(24)].join("_"),
  RK_LIVE: ["rk", "live", tail(24)].join("_"),
  SK_TEST: ["sk", "test", tail(24)].join("_"),
  PK_LIVE: ["pk", "live", tail(24)].join("_"),
  WHSEC: ["wh" + "sec", tail(32)].join("_"),
  SB_SECRET: ["sb", "secret", tail(32)].join("_"),
  SB_PUBLISHABLE: ["sb", "publishable", tail(32)].join("_"),
  JWT_SERVICE_ROLE: jwt("service_role"),
  JWT_ANON: jwt("anon"),
};

/** Replaces every __NAME__ token in `text` with the matching fake. */
export function fill(text) {
  return text.replace(/__([A-Z_]+)__/g, (whole, name) => (name in FAKES ? FAKES[name] : whole));
}

/** Values that must never appear in scanner output (the JWT payload segment is checked too). */
export const FAKE_SECRETS = [
  FAKES.SK_LIVE,
  FAKES.RK_LIVE,
  FAKES.SK_TEST,
  FAKES.WHSEC,
  FAKES.SB_SECRET,
  FAKES.JWT_SERVICE_ROLE,
  FAKES.JWT_SERVICE_ROLE.split(".")[1],
  FAKES.JWT_SERVICE_ROLE.split(".")[2],
  "fakesecretvalue1234567890",
  "fakeprivatevalue1234567890",
];
