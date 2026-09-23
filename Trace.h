#pragma once
#include <string>
#include <vector>
#include <ostream>

// Something that happened during one global tick.
struct Event {
	std::string type;  // arrive, io_done, boost, dispatch, preempt, block, complete
	int pid = -1;
	int from = -1;     // level before (preempt/block) or level (arrive/io_done/dispatch)
	int to = -1;       // level after (preempt/block)
	int quantum = -1;  // dispatch only
};

struct ProcSnapshot {
	int pid;
	const char* state;
	int level;
	int remaining;
};

// Scheduler state at the end of one global tick.
struct TickSnapshot {
	int t = 0;
	int running = -1;    // pid that used the CPU during this tick, -1 if idle
	int run_level = -1;  // level it ran at
	int slice_used = 0;  // ticks of the current quantum used so far
	int slice_len = 0;   // length of the current quantum
	std::vector<std::vector<int>> queues;
	std::vector<int> blocked;
	int io_left = 0;     // I/O ticks left for the head of the blocked queue
	std::vector<Event> events;
	std::vector<ProcSnapshot> procs;
};

inline void json_int_array(std::ostream& o, const std::vector<int>& v) {
	o << '[';
	for (size_t i = 0; i < v.size(); i++) o << (i ? "," : "") << v[i];
	o << ']';
}

inline void json_string(std::ostream& o, const std::string& s) {
	o << '"';
	for (char c : s) {
		if (c == '"' || c == '\\') o << '\\' << c;
		else if ((unsigned char)c < 0x20) o << ' ';
		else o << c;
	}
	o << '"';
}

inline void json_event(std::ostream& o, const Event& e) {
	o << "{\"type\":";
	json_string(o, e.type);
	if (e.pid != -1) o << ",\"pid\":" << e.pid;
	if (e.from != -1) o << ",\"from\":" << e.from;
	if (e.to != -1) o << ",\"to\":" << e.to;
	if (e.quantum != -1) o << ",\"quantum\":" << e.quantum;
	o << '}';
}

inline void json_tick(std::ostream& o, const TickSnapshot& s) {
	o << "{\"t\":" << s.t << ",\"running\":" << s.running
	  << ",\"run_level\":" << s.run_level
	  << ",\"slice\":[" << s.slice_used << ',' << s.slice_len << "]"
	  << ",\"queues\":[";
	for (size_t i = 0; i < s.queues.size(); i++) {
		if (i) o << ',';
		json_int_array(o, s.queues[i]);
	}
	o << "],\"blocked\":";
	json_int_array(o, s.blocked);
	o << ",\"io_left\":" << s.io_left << ",\"events\":[";
	for (size_t i = 0; i < s.events.size(); i++) {
		if (i) o << ',';
		json_event(o, s.events[i]);
	}
	o << "],\"procs\":[";
	for (size_t i = 0; i < s.procs.size(); i++) {
		const auto& p = s.procs[i];
		if (i) o << ',';
		o << "{\"pid\":" << p.pid << ",\"state\":\"" << p.state << "\",\"level\":" << p.level
		  << ",\"remaining\":" << p.remaining << '}';
	}
	o << "]}";
}
