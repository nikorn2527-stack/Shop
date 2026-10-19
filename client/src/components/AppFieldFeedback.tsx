import { useEffect } from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const selector = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]):not([type="color"]):not([type="button"]):not([type="submit"]), select, textarea';
const excluded = '.print-preview-paper, .report-doc, .receipt-paper, .member-card-document, .search-field, .search-box, .global-search, .scan-hero, .member-scan-field, [role="search"], [data-field-feedback="off"]';
const captions = { filled: "มีข้อมูล", empty: "ยังไม่กรอก", missing: "จำเป็นต้องกรอก", invalid: "ตรวจสอบข้อมูล" };

/** Presentation only: never changes values, native constraints or submission behavior. */
export function AppFieldFeedback() {
  useEffect(() => {
    const touched = new WeakSet<Element>();
    let frame = 0;
    const refresh = () => {
      frame = 0;
      document.querySelectorAll<Field>(selector).forEach(field => {
        const label = field.labels?.length === 1 ? field.labels[0] : null;
        if (field.disabled || ('readOnly' in field && field.readOnly) || field.closest(excluded)) {
          field.removeAttribute('data-field-state');
          label?.removeAttribute('data-field-caption');
          return;
        }
        const filled = field.value.trim() !== '';
        const required = field.required || field.getAttribute('aria-required') === 'true' || label?.textContent?.includes('*');
        const invalid = field.getAttribute('aria-invalid') === 'true' || (touched.has(field) && (!field.validity.valid || (required && !filled)));
        const state = invalid ? 'invalid' : filled ? 'filled' : required ? 'missing' : 'empty';
        field.dataset.fieldState = state;
        // A group label containing several controls must not get an ambiguous caption.
        if (label && label.querySelectorAll(selector).length === 1) label.dataset.fieldCaption = captions[state];
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
    const onBlur = (event: Event) => { if (event.target instanceof Element && event.target.matches(selector)) touched.add(event.target); schedule(); };
    const onSubmit = (event: Event) => {
      if (event.target instanceof HTMLFormElement) event.target.querySelectorAll(selector).forEach(field => touched.add(field));
      schedule();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['value', 'required', 'disabled', 'readonly', 'aria-invalid', 'selected'] });
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    document.addEventListener('click', schedule, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('submit', onSubmit, true);
    schedule();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame);
      document.removeEventListener('input', schedule, true);
      document.removeEventListener('change', schedule, true);
      document.removeEventListener('click', schedule, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);
  return null;
}
