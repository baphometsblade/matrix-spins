/* Matrix Spins - Client Performance Monitoring */
(function() {
    'use strict';

    // Track page load performance
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (!window.performance || !window.performance.timing) return;
            var t = window.performance.timing;
            var metrics = {
                dns: t.domainLookupEnd - t.domainLookupStart,
                tcp: t.connectEnd - t.connectStart,
                ttfb: t.responseStart - t.requestStart,
                domReady: t.domContentLoadedEventEnd - t.navigationStart,
                fullLoad: t.loadEventEnd - t.navigationStart
            };
            // Report to analytics endpoint
            fetch('/api/perf/client', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(metrics)
            }).catch(function() {});
        }, 1000);
    });

    // Track long tasks
    if (window.PerformanceObserver) {
        try {
            var obs = new PerformanceObserver(function(list) {
                list.getEntries().forEach(function(entry) {
                    if (entry.duration > 100) {
                        console.debug('[Perf] Long task: ' + entry.duration.toFixed(0) + 'ms');
                    }
                });
            });
            obs.observe({ entryTypes: ['longtask'] });
        } catch(e) {}
    }
})();
