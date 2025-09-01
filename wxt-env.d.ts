/// <reference types="wxt/client" />

declare global {
  function defineContentScript(config: any): any;
  function defineBackground(config: () => void): any;
}