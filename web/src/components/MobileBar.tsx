"use client";

/** Sadece telefonda: arama sonuçlarında gezinirken kaç künye seçildiğini ve kayıt durumunu alttan gösterir. */
export default function MobileBar({ count, dirty }: { count: number; dirty: boolean }) {
  if (count === 0) return null;
  return (
    <div className="mobile-bar" role="status">
      <span>
        <b>{count}</b> künye seçili{dirty ? " · kaydedilmedi" : ""}
      </span>
      <button
        type="button"
        onClick={() => {
          const el = document.getElementById("secili-panel");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
          window.setTimeout(() => document.getElementById("liste-adi")?.focus({ preventScroll: true }), 400);
        }}
      >
        {dirty ? "Kaydet" : "Listeye git"}
      </button>
    </div>
  );
}
