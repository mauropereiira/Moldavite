/**
 * Injected into the page on demand. Returns raw HTML rather than converting
 * here: conversion stays in convert.js where it can be tested without a browser,
 * and this script stays small enough to read in one go.
 *
 * The last expression is the script's result, which is what
 * `chrome.scripting.executeScript` hands back to the popup.
 */
({
  html: document.documentElement.outerHTML,
  url: location.href,
  title: document.title,
});
