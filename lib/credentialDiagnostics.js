"use strict";

function describeIdentifier(value) {
  if (!value) return "not set";
  const stringValue = String(value);
  const visibleLength = Math.min(4, Math.max(0, stringValue.length - 1));
  const prefix = stringValue
    .slice(0, visibleLength)
    .replace(/[^\x20-\x7E]/g, "?");
  return `${prefix}*** (${stringValue.length} chars)`;
}

function describeSecret(value) {
  if (!value) return "not set";
  return `set (${String(value).length} chars)`;
}

function getCredentialDiagnostics({
  authMethod,
  clientId,
  clientSecret,
  username,
  password,
}) {
  return [
    `authMethod=${authMethod || "none"}`,
    `clientId=${describeIdentifier(clientId)}`,
    `clientSecret=${describeSecret(clientSecret)}`,
    `username=${describeIdentifier(username)}`,
    `password=${describeSecret(password)}`,
  ].join("; ");
}

module.exports = {
  getCredentialDiagnostics,
};
