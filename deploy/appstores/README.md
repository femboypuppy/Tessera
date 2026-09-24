# App-store templates

Templates for the home-server app stores where r/selfhosted people find apps. Each runs the
published image `ghcr.io/femboypuppy/tessera` with its data in the store's usual folder.

| Store | Files | How to submit |
|---|---|---|
| **Unraid** (Community Applications) | [`unraid/tessera.xml`](unraid/tessera.xml) | Keep the template in this repository (its `TemplateURL` points here) and ask the Community Applications maintainers, in their support thread on the Unraid forums, to add this repository. Users can install it right away: Docker → Add Container → paste the template URL. |
| **CasaOS** | [`casaos/docker-compose.yml`](casaos/docker-compose.yml) | Open a pull request adding `Apps/Tessera/docker-compose.yml` (plus screenshots) to [IceWhaleTech/CasaOS-AppStore](https://github.com/IceWhaleTech/CasaOS-AppStore). Users can install it now with App Store → Custom Install → Import. |
| **Umbrel** | [`umbrel/tessera/`](umbrel/tessera) | Copy the folder into a fork of [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps), add three gallery images, pin the image to a digest, and open a pull request (fill in `submission`). A [community app store](https://github.com/getumbrel/umbrel-community-app-store) works for testing. |

## Notes for maintainers

- **Data ownership.** The image runs as `node` (uid 1000). Unraid and CasaOS create the app's
  data folder owned by root, so those templates start the container as root: the entrypoint gives
  the folder to uid 1000 once and runs the server unprivileged. Umbrel's data folders are already
  owned by uid 1000, so the Umbrel template runs as `1000:1000` directly.
- **Versions.** Unraid and CasaOS follow `latest`; Umbrel apps pin a version (and, when submitted,
  a digest). Bump `version` and the image tag in `umbrel-app.yml` and `docker-compose.yml` with
  each release.
- **Owner account.** Every template's description says how to create the first account
  (`tessera-server create-owner` in the app's terminal).
- **Icon.** The templates use the placeholder app icon; point them at the final logo in `assets/`
  once it exists.
