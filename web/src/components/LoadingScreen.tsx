"use client";

/**
 * Oturum ve arşiv yüklenirken gösterilen ekran.
 * Gerçek sayfa düzeninin iskeletini çizer; veri gelince içerik aynı yerlere oturur, sayfa zıplamaz.
 */
export default function LoadingScreen({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div aria-busy={!error} aria-live="polite">
      <header>
        <div className="wrap !p-0 flex justify-between items-start gap-3">
          <div>
            <h1>🏷️ Künye Arşivi</h1>
            <p>Manav ürün künyelerini arşivleyin, arayın, A4 şablona ekleyip yazdırın.</p>
          </div>
          {!error && <div className="skel h-3.5 w-28 mt-1.5" />}
        </div>
      </header>

      <div className="wrap">
        {error ? (
          <div className="panel max-w-md">
            <h2>Sunucuya bağlanılamadı</h2>
            <p className="m-0 mb-3 text-sm text-stone-500 dark:text-stone-400">
              {error}. Bağlantını kontrol edip tekrar dene; sorun sürerse API servisinin çalıştığından emin ol.
            </p>
            <button type="button" className="retry-btn" onClick={onRetry}>
              Tekrar dene
            </button>
          </div>
        ) : (
          <>
            <span className="sr-only">Arşiv yükleniyor</span>
            <div className="layout-grid" aria-hidden="true">
              <div>
                <div className="panel">
                  <div className="skel h-4 w-32 mb-3" />
                  <div className="skel-drop" />
                </div>
                <div className="panel">
                  <div className="skel h-4 w-24 mb-3" />
                  <div className="skel h-9 w-full mb-2" />
                  <div className="skel h-9 w-full mb-2" />
                  <div className="skel h-9 w-2/3" />
                </div>
              </div>
              <div>
                <div className="panel">
                  <div className="skel h-4 w-28 mb-3" />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="skel-label" />
                    <div className="skel-label" />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
