/**
 * Performance Monitoring Module (IIFE)
 * Collects Core Web Vitals and page performance metrics
 * Posts data to /api/perf endpoint (fire-and-forget)
 */

window.PerfMonitor = (function() {
    'use strict';

    // Private state
    let metrics = {};
    let initialized = false;

    /**
     * Get page load time in milliseconds
     * Uses Navigation Timing API if available, fallback to performance.now()
     */
    function getPageLoadTime() {
        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;
            if (timing.loadEventEnd > 0 && timing.navigationStart > 0) {
                return timing.loadEventEnd - timing.navigationStart;
            }
        }
        // Fallback: time since page started loading (approximate)
        if (window.performance && window.performance.now) {
            return Math.round(window.performance.now());
        }
        return null;
    }

    /**
     * Get First Contentful Paint via PerformanceObserver
     */
    function observeFCP() {
        return new Promise((resolve) => {
            try {
                const observer = new PerformanceObserver((entryList) => {
                    const entries = entryList.getEntries();
                    if (entries.length > 0) {
                        const fcp = Math.round(entries[entries.length - 1].startTime);
                        observer.disconnect();
                        resolve(fcp);
                    }
                });
                observer.observe({ type: 'paint', buffered: true });
                // Timeout: if FCP not captured in 10 seconds, resolve null
                setTimeout(() => {
                    observer.disconnect();
                    resolve(null);
                }, 10000);
            } catch (err) {
                resolve(null); // PerformanceObserver not supported
            }
        });
    }

    /**
     * Get Largest Contentful Paint via PerformanceObserver
     */
    function observeLCP() {
        return new Promise((resolve) => {
            try {
                let lcpValue = null;
                const observer = new PerformanceObserver((entryList) => {
                    const entries = entryList.getEntries();
                    if (entries.length > 0) {
                        lcpValue = Math.round(entries[entries.length - 1].renderTime || entries[entries.length - 1].loadTime);
                    }
                });
                observer.observe({ type: 'largest-contentful-paint', buffered: true });
                // LCP is continuously updated; capture at 5 seconds
                setTimeout(() => {
                    observer.disconnect();
                    resolve(lcpValue);
                }, 5000);
            } catch (err) {
                resolve(null); // PerformanceObserver not supported
            }
        });
    }

    /**
     * Approximate Time to Interactive (TTI)
     * Simple heuristic: time until long tasks are gone + DOM interactive
     */
    function getTimeToInteractive() {
        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;
            // Use domInteractive as a proxy for TTI
            if (timing.domInteractive > 0 && timing.navigationStart > 0) {
                return timing.domInteractive - timing.navigationStart;
            }
        }
        return null;
    }

    /**
     * Get memory usage if available
     */
    function getMemoryUsage() {
        if (window.performance && window.performance.memory) {
            return {
                usedJSHeapSize: Math.round(window.performance.memory.usedJSHeapSize / 1024 / 1024 * 100) / 100, // MB
                totalJSHeapSize: Math.round(window.performance.memory.totalJSHeapSize / 1024 / 1024 * 100) / 100,
                jsHeapSizeLimit: Math.round(window.performance.memory.jsHeapSizeLimit / 1024 / 1024 * 100) / 100,
            };
        }
        return null;
    }

    /**
     * Get number of DOM nodes
     */
    function getDOMNodeCount() {
        try {
            return document.getElementsByTagName('*').length;
        } catch (err) {
            return null;
        }
    }

    /**
     * Send metrics to backend
     * Fire-and-forget: no error handling, silent fail
     */
    function sendMetrics(metricsData) {
        try {
            // Add user agent and URL for context
            const payload = {
                ...metricsData,
                url: window.location.href,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString(),
            };

            // Use fetch with no awaiting (fire-and-forget)
            fetch('/api/perf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                keepalive: true, // ensure request completes even if page unloads
            }).catch(() => {
                // Silent fail — no logging
            });
        } catch (err) {
            // Silent fail
        }
    }

    /**
     * Log metrics summary to console.warn
     */
    function logSummary(metricsData) {
        try {
            const summary = [
                'Performance Metrics:',
                `  Page Load: ${metricsData.pageLoadTime !== null ? metricsData.pageLoadTime + 'ms' : 'N/A'}`,
                `  First Contentful Paint: ${metricsData.fcp !== null ? metricsData.fcp + 'ms' : 'N/A'}`,
                `  Largest Contentful Paint: ${metricsData.lcp !== null ? metricsData.lcp + 'ms' : 'N/A'}`,
                `  Time to Interactive: ${metricsData.tti !== null ? metricsData.tti + 'ms' : 'N/A'}`,
                `  DOM Nodes: ${metricsData.domNodes !== null ? metricsData.domNodes : 'N/A'}`,
            ];

            if (metricsData.memory) {
                summary.push(`  Memory Used: ${metricsData.memory.usedJSHeapSize}MB / ${metricsData.memory.totalJSHeapSize}MB`);
            }

            console.warn(summary.join('\n'));
        } catch (err) {
            // Silent fail
        }
    }

    /**
     * Initialize monitoring
     * Collects metrics with a 5-second delay to capture LCP
     */
    async function init() {
        if (initialized) return;
        initialized = true;

        try {
            // Start collecting immediately
            metrics.pageLoadTime = getPageLoadTime();
            metrics.tti = getTimeToInteractive();
            metrics.domNodes = getDOMNodeCount();
            metrics.memory = getMemoryUsage();

            // Collect paint metrics (FCP, LCP) — these need PerformanceObserver
            // Run in parallel
            const [fcp, lcp] = await Promise.all([observeFCP(), observeLCP()]);
            metrics.fcp = fcp;
            metrics.lcp = lcp;

            // Log summary immediately after collection
            logSummary(metrics);

            // Send to backend (fire-and-forget, after 5 second delay for LCP stability)
            setTimeout(() => {
                sendMetrics(metrics);
            }, 5000);
        } catch (err) {
            // Silent fail on any error
        }
    }

    /**
     * Get collected metrics (synchronous)
     */
    function getMetrics() {
        return { ...metrics };
    }

    // Public API
    return {
        init: init,
        getMetrics: getMetrics,
    };
})();

// Auto-initialize on DOM ready or page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.PerfMonitor.init();
    });
} else {
    window.PerfMonitor.init();
}
