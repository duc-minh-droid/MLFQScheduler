#include <iostream>
#include "Scheduler.h"
#include "Process.h"
#include "CPU.h"
#include "Workload.h"
#include "Trace.h"
#include <memory>
#include <map>
#include <string>
#include <cstdlib>
#include <iomanip>

static void usage() {
    std::cerr <<
        "usage: mlfq [--workload FILE|-] [--quanta Q0,Q1,Q2] [--boost N] [--trace]\n"
        "\n"
        "  --workload FILE  read processes from FILE ('-' = stdin). Without it the\n"
        "                   built-in two-process demo runs.\n"
        "  --quanta LIST    time slice per level, comma separated (default 1,2,4)\n"
        "  --boost N        move every process back to level 0 every N ticks (0 = off)\n"
        "  --trace          print one JSON document with the state after every tick\n";
}

static std::string list_str(const std::deque<int>& q) {
    std::string s = "[";
    for (size_t i = 0; i < q.size(); i++) s += (i ? " " : "") + std::to_string(q[i]);
    return s + "]";
}

static std::string event_str(const Event& e) {
    if (e.type == "boost") return "BOOST all->L0";
    std::string p = "P" + std::to_string(e.pid);
    if (e.type == "arrive") return p + " arrives";
    if (e.type == "io_done") return p + " I/O done";
    if (e.type == "dispatch") return p + " dispatched q=" + std::to_string(e.quantum);
    if (e.type == "preempt") return p + " preempted L" + std::to_string(e.from) + "->L" + std::to_string(e.to);
    if (e.type == "block") return p + " blocks for I/O L" + std::to_string(e.from) + "->L" + std::to_string(e.to);
    if (e.type == "complete") return p + " done";
    return p + " " + e.type;
}

int main(int argc, char** argv)
{
    Workload w = default_workload();
    bool trace = false;
    std::string quanta_arg;
    int boost_arg = -1;

    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto need = [&](const char* flag) -> std::string {
            if (i + 1 >= argc) { std::cerr << flag << " needs a value\n"; std::exit(2); }
            return argv[++i];
        };
        if (a == "--trace" || a == "--json") trace = true;
        else if (a == "--workload" || a == "-w") {
            std::string path = need("--workload"), err;
            bool ok = path == "-" ? parse_workload(std::cin, w, err) : load_workload(path, w, err);
            if (!ok) { std::cerr << "workload error: " << err << "\n"; return 1; }
        }
        else if (a == "--quanta") quanta_arg = need("--quanta");
        else if (a == "--boost") boost_arg = std::atoi(need("--boost").c_str());
        else if (a == "--help" || a == "-h") { usage(); return 0; }
        else { std::cerr << "unknown argument " << a << "\n"; usage(); return 2; }
    }
    if (!quanta_arg.empty()) w.quanta = parse_int_list(quanta_arg);
    if (boost_arg >= 0) w.boost = boost_arg;
    if (w.quanta.empty()) { std::cerr << "quanta list is empty\n"; return 2; }
    for (int q : w.quanta) if (q < 1) { std::cerr << "quanta must be >= 1\n"; return 2; }

    std::map<int, Process> process_table;
    for (auto& s : w.procs) {
        process_table.insert({ s.pid, Process(s.pid, s.burst, s.io_every, s.arrival, s.io_duration) });
    }

    Scheduler scheduler(process_table, w.quanta);
    CPU cpu(process_table);

    std::vector<TickSnapshot> history;
    const int MAX_TICKS = 100000;

    for (int t = 0; t < MAX_TICKS; t++) {
        TickSnapshot snap;
        snap.t = t;

        // 1. new arrivals join the top queue
        for (auto& s : w.procs) {
            if (s.arrival == t) {
                scheduler.enqueue(s.pid);
                snap.events.push_back({ "arrive", s.pid, 0 });
            }
        }

        // 2. the I/O device works on the head of the blocked queue
        int io_pid = scheduler.io_tick();
        if (io_pid != -1)
            snap.events.push_back({ "io_done", io_pid, process_table[io_pid].level() });

        // 3. periodic priority boost
        if (w.boost > 0 && t > 0 && t % w.boost == 0) {
            scheduler.boost();
            snap.events.push_back({ "boost" });
        }

        // 4. an idle CPU takes the front of the highest non-empty queue
        if (cpu.state() == CPU_STATE::IDLE && !scheduler.empty()) {
            int pid = scheduler.schedule();
            int q = scheduler.quantum_for_level(process_table[pid].level());
            cpu.assign(pid, q);
            auto& p = process_table[pid];
            if (p.first_run_ < 0) p.first_run_ = t;
            snap.events.push_back({ "dispatch", pid, p.level(), -1, q });
        }

        for (auto& q : scheduler.ready_queues())
            for (int pid : q) process_table[pid].wait_ticks_++;

        // 5. run one tick on the CPU and feed the result back to the scheduler
        int running = cpu.state() == CPU_STATE::RUNNING ? cpu.current_pid() : -1;
        int from = running != -1 ? process_table[running].level() : -1;
        auto result = cpu.tick();
        snap.running = running;
        snap.run_level = from;
        if (running != -1) {
            snap.slice_used = cpu.ticks_used();
            snap.slice_len = cpu.quantum();
            scheduler.handle_event(running, result);
            int to = process_table[running].level();
            if (result == TickResult::PREEMPTED) snap.events.push_back({ "preempt", running, from, to });
            else if (result == TickResult::BLOCKED) snap.events.push_back({ "block", running, from, to });
            else if (result == TickResult::TERMINATED) {
                process_table[running].finish_ = t + 1;
                snap.events.push_back({ "complete", running, from });
            }
        }

        for (auto& q : scheduler.ready_queues()) snap.queues.emplace_back(q.begin(), q.end());
        snap.blocked.assign(scheduler.blocked().begin(), scheduler.blocked().end());
        if (!snap.blocked.empty()) snap.io_left = process_table[snap.blocked.front()].io_remaining_;
        bool all_done = true;
        for (auto& [pid, p] : process_table) {
            snap.procs.push_back({ pid, state_name(p.state()), p.level(), p.ticks() });
            if (p.state() != PROCESS_STATE::TERMINATED) all_done = false;
        }

        if (!trace) {
            std::cout << "t=" << std::setw(3) << t << " | "
                      << (running == -1 ? std::string("idle ")
                                        : "P" + std::to_string(running) + "@L" + std::to_string(from))
                      << " |";
            for (int l = 0; l < LEVELS; l++) std::cout << " Q" << l << list_str(scheduler.ready_queues()[l]);
            std::cout << " | io" << list_str(scheduler.blocked()) << " |";
            for (auto& e : snap.events) std::cout << ' ' << event_str(e) << ';';
            std::cout << '\n';
        }

        history.push_back(std::move(snap));
        if (all_done) break;
    }

    int total = (int)history.size();
    int busy = 0;
    for (auto& s : history) if (s.running != -1) busy++;
    double sum_turn = 0, sum_resp = 0, sum_wait = 0;
    for (auto& [pid, p] : process_table) {
        sum_turn += p.finish_ - p.arrival_;
        sum_resp += p.first_run_ - p.arrival_;
        sum_wait += p.wait_ticks_;
    }
    int n = (int)process_table.size();

    if (trace) {
        std::ostream& o = std::cout;
        o << "{\"name\":";
        json_string(o, w.name);
        o << ",\"levels\":" << LEVELS << ",\"quanta\":";
        json_int_array(o, w.quanta);
        o << ",\"boost\":" << w.boost << ",\"processes\":[";
        for (size_t i = 0; i < w.procs.size(); i++) {
            auto& s = w.procs[i];
            o << (i ? "," : "") << "{\"pid\":" << s.pid << ",\"arrival\":" << s.arrival
              << ",\"burst\":" << s.burst << ",\"io_every\":" << s.io_every
              << ",\"io_duration\":" << s.io_duration << '}';
        }
        o << "],\n\"ticks\":[\n";
        for (size_t i = 0; i < history.size(); i++) {
            if (i) o << ",\n";
            json_tick(o, history[i]);
        }
        o << "\n],\n\"summary\":{\"total_ticks\":" << total << ",\"busy_ticks\":" << busy
          << ",\"per_process\":[";
        bool first = true;
        for (auto& [pid, p] : process_table) {
            o << (first ? "" : ",") << "{\"pid\":" << pid << ",\"arrival\":" << p.arrival_
              << ",\"burst\":" << p.burst_
              << ",\"first_run\":" << p.first_run_ << ",\"finish\":" << p.finish_
              << ",\"turnaround\":" << (p.finish_ - p.arrival_)
              << ",\"response\":" << (p.first_run_ - p.arrival_)
              << ",\"waiting\":" << p.wait_ticks_ << '}';
            first = false;
        }
        o << "]}}\n";
        return 0;
    }

    std::cout << "\n" << w.name << ": " << total << " ticks, CPU busy " << busy << "/" << total << "\n\n";
    std::cout << " pid  arrive  burst  first  finish  turnaround  response  waiting\n";
    for (auto& [pid, p] : process_table) {
        std::cout << std::setw(4) << pid << std::setw(8) << p.arrival_ << std::setw(7) << p.burst_
                  << std::setw(7) << p.first_run_ << std::setw(8) << p.finish_
                  << std::setw(12) << (p.finish_ - p.arrival_) << std::setw(10) << (p.first_run_ - p.arrival_)
                  << std::setw(9) << p.wait_ticks_ << "\n";
    }
    std::cout << std::fixed << std::setprecision(2)
              << "\navg turnaround " << sum_turn / n << ", avg response " << sum_resp / n
              << ", avg waiting " << sum_wait / n << "\n";
    return 0;
}
