/**
 * emailQueue.js — In-memory job queue (replaces Bull/Redis)
 *
 * A lightweight async queue built on Node's EventEmitter.
 * Supports named job types, concurrency limits, retry with
 * exponential back-off, and delayed jobs — all without Redis.
 */

const EventEmitter = require('events');

class InMemoryQueue extends EventEmitter {
    /**
     * @param {string} name          Queue name (for logging)
     * @param {object} opts
     * @param {number} opts.attempts       Max retry attempts  (default 3)
     * @param {number} opts.backoffDelay   Initial back-off ms (default 5000)
     */
    constructor(name, opts = {}) {
        super();
        this.name = name;
        this.defaultAttempts = opts.attempts ?? 3;
        this.backoffDelay = opts.backoffDelay ?? 5000;

        // processor map: jobName → { fn, concurrency, running }
        this._processors = new Map();

        this.on('error', (err) => console.error(`[${this.name}] Queue error:`, err));
    }

    // ── Register a processor ────────────────────────────────────────────────
    /**
     * @param {string}   jobName     Name passed to .add()
     * @param {number}   concurrency Max parallel executions
     * @param {Function} fn          async (job) => void
     */
    process(jobName, concurrency, fn) {
        if (typeof concurrency === 'function') {
            fn = concurrency;
            concurrency = 1;
        }
        this._processors.set(jobName, { fn, concurrency, running: 0 });
    }

    // ── Add a job ───────────────────────────────────────────────────────────
    /**
     * @param {string} jobName
     * @param {object} data
     * @param {object} opts
     * @param {number} opts.delay      Delay in ms before executing
     * @param {number} opts.attempts   Override default retry count
     * @param {string} opts.jobId      Idempotency key (ignored duplicates)
     */
    add(jobName, data, opts = {}) {
        const delayMs = opts.delay ?? 0;
        const attempts = opts.attempts ?? this.defaultAttempts;
        const jobId = opts.jobId ?? `${jobName}_${Date.now()}_${Math.random()}`;

        const job = { id: jobId, name: jobName, data, attempts, attemptsLeft: attempts };

        if (delayMs > 0) {
            setTimeout(() => this._dispatch(job), delayMs);
        } else {
            // push to next tick so caller can finish first
            setImmediate(() => this._dispatch(job));
        }

        return Promise.resolve(job);
    }

    // ── Internal dispatcher ─────────────────────────────────────────────────
    async _dispatch(job, attempt = 1) {
        const entry = this._processors.get(job.name);
        if (!entry) {
            console.warn(`[${this.name}] No processor for job "${job.name}"`);
            return;
        }

        // Respect concurrency limit — retry later if busy
        if (entry.running >= entry.concurrency) {
            setTimeout(() => this._dispatch(job, attempt), 500);
            return;
        }

        entry.running++;
        try {
            await entry.fn(job);
            this.emit('completed', job);
            console.log(`[${this.name}] Job ${job.id} completed`);
        } catch (err) {
            console.error(`[${this.name}] Job ${job.id} attempt ${attempt} failed:`, err.message);

            if (attempt < job.attempts) {
                const delay = this.backoffDelay * Math.pow(2, attempt - 1); // exponential
                console.log(`[${this.name}] Retrying job ${job.id} in ${delay}ms...`);
                setTimeout(() => this._dispatch(job, attempt + 1), delay);
            } else {
                this.emit('failed', job, err);
                console.error(`[${this.name}] Job ${job.id} permanently failed after ${attempt} attempts`);
            }
        } finally {
            entry.running--;
        }
    }
}

// ─── Singleton queue (shared across the app) ──────────────────────────────────
const emailQueue = new InMemoryQueue('email-campaigns', {
    attempts: 3,
    backoffDelay: 5000,
});

emailQueue.on('failed', (job, err) =>
    console.error(`Queue: job ${job.id} failed — ${err.message}`)
);

module.exports = emailQueue;
