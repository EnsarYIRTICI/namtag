"use client";

/** Sadece telefonda: arama sonuçlarında gezinirken kaç künye seçildiğini ve kayıt durumunu alttan gösterir. */
export default function MobileBar({ count, bekleyen, dirty }: { count: number; bekleyen: number; dirty: boolean }) {
  if (count === 0 && bekleyen === 0) return null;
  return (
    <div className="mobile-bar" role="status">
      <span>
        <b>{count}</b> künye{bekleyen ? <> + <b>{bekleyen}</b> bekleyen</> : " seçili"}
        {dirty ? " · kaydedilmedi" : ""}
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
