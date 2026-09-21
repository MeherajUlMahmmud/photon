import type { PhotonApi } from "../../preload/api";

declare global {
  interface Window {
    photon: PhotonApi;
  }
}

export {};
