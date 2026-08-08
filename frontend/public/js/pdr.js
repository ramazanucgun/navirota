// frontend/public/js/pdr.js
//
// PDR (Pedestrian Dead Reckoning) — PRD Bölüm 1.4 / Bölüm 6.3'te önerilen,
// donanım gerektirmeyen "QR-sonrası yaklaşık konum" iyileştirmesi.
//
// Fikir: Kullanıcı bir QR okuttuğunda kesin bir başlangıç noktası biliriz.
// Bundan sonra telefonun DeviceMotion (ivmeölçer) ve DeviceOrientation
// (pusula/yön) sensörlerini kullanarak adım sayısı + yürüme yönünü tahmin
// edip haritadaki "mavi nokta"yı QR'ı tekrar okutmaya gerek kalmadan
// yaklaşık olarak güncelleriz. Bu KESİN konum değildir — sürüklenme
// (drift) birikir — bu yüzden yalnızca görsel bir ipucu olarak kullanılır
// ve her yeni QR okutmada sıfırlanıp kalibre edilir.
//
// Hiçbir ekstra donanım (BLE/Wi-Fi RTLS) gerektirmez; yalnızca tarayıcının
// standart hareket sensörü API'lerini kullanır. iOS 13+'da izin istemi
// gerekir (requestPermission).

const SmartWayPDR = (() => {
  let listening = false;
  let stepCount = 0;
  let heading = 0;           // derece, 0 = kuzey
  let position = { x: 0, y: 0 }; // QR başlangıç noktasına göre göreli piksel ofseti
  let lastAccelMagnitude = 0;
  let lastStepAt = 0;
  const STEP_LENGTH_PX = 18;         // ortalama adım uzunluğu (harita ölçeğine göre kabaca kalibre edilir)
  const STEP_THRESHOLD = 11.5;        // ivme sıçraması eşiği (m/s²), adım tespiti için
  const MIN_STEP_INTERVAL_MS = 300;   // art arda yanlış-pozitif adım tespitini önler

  let onUpdateCallback = null;

  function handleMotion(event) {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;
    const magnitude = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
    const now = Date.now();

    // Basit tepe-algılama (peak detection) tabanlı adım sayacı.
    if (magnitude > STEP_THRESHOLD && lastAccelMagnitude <= STEP_THRESHOLD && (now - lastStepAt) > MIN_STEP_INTERVAL_MS) {
      stepCount++;
      lastStepAt = now;
      advancePosition();
    }
    lastAccelMagnitude = magnitude;
  }

  function handleOrientation(event) {
    // alpha: cihazın kuzeye göre dönüşü (derece). webkitCompassHeading iOS'ta daha doğru.
    heading = event.webkitCompassHeading ?? (360 - (event.alpha || 0));
  }

  function advancePosition() {
    const rad = (heading * Math.PI) / 180;
    position.x += Math.sin(rad) * STEP_LENGTH_PX;
    position.y -= Math.cos(rad) * STEP_LENGTH_PX;
    if (onUpdateCallback) onUpdateCallback({ ...position, heading, stepCount });
  }

  /**
   * QR okutulduğunda çağrılır: göreli konumu sıfırlar (yeniden kalibrasyon).
   */
  function reset() {
    position = { x: 0, y: 0 };
    stepCount = 0;
  }

  /**
   * Sensör dinlemeyi başlatır. iOS 13+'da kullanıcı jesti içinde
   * çağrılmalı (izin isteminin tarayıcı politikası gereği).
   * @param {(update: {x:number,y:number,heading:number,stepCount:number}) => void} onUpdate
   * @returns {Promise<boolean>} destekleniyor ve izin verildiyse true
   */
  async function start(onUpdate) {
    if (listening) return true;
    if (typeof DeviceMotionEvent === 'undefined') return false;

    onUpdateCallback = onUpdate;

    // iOS: açık izin isteği gerekir. Android/diğer: doğrudan dinlenebilir.
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const motionPerm = await DeviceMotionEvent.requestPermission();
        if (motionPerm !== 'granted') return false;
      } catch { return false; }
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { await DeviceOrientationEvent.requestPermission(); } catch { /* devam et, yön olmadan da adım sayılabilir */ }
    }

    window.addEventListener('devicemotion', handleMotion);
    window.addEventListener('deviceorientation', handleOrientation);
    listening = true;
    return true;
  }

  function stop() {
    window.removeEventListener('devicemotion', handleMotion);
    window.removeEventListener('deviceorientation', handleOrientation);
    listening = false;
  }

  return { start, stop, reset, isListening: () => listening };
})();

window.SmartWayPDR = SmartWayPDR;
