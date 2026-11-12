// @ts-check
/**
 * How the reference library reads credentials here, the same in the extension and in the tests: nothing is
 * fetched. Remote manifests (credentials an image only points to by URL) are not followed, since following them
 * would tell that server which image you are looking at; certificate revocation (OCSP) is not looked up. Trust
 * lists: none yet, so a signer shows as "not verified" unless a trust list is added.
 */
export const READ_SETTINGS = Object.freeze({
  verify: Object.freeze({
    remoteManifestFetch: false,
    ocspFetch: false,
    verifyTrust: true,
  }),
});

/** The same settings as c2pa-rs reads them (snake_case JSON), for the WASM build used directly in tests. */
export const READ_SETTINGS_JSON = JSON.stringify({
  verify: { remote_manifest_fetch: false, ocsp_fetch: false, verify_trust: true },
});
