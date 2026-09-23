#pragma once
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <algorithm>
#include <set>

// One process in a workload file:
//   pid arrival burst io_every io_duration
// io_every <= 0 means the process never blocks on I/O.
struct ProcessSpec {
	int pid = 0;
	int arrival = 0;
	int burst = 1;
	int io_every = -1;
	int io_duration = 1;
};

struct Workload {
	std::string name = "default";
	std::vector<int> quanta = { 1, 2, 4 };
	int boost = 0;  // 0 = priority boost disabled
	std::vector<ProcessSpec> procs;
};

// The two processes the original main() hard-coded.
inline Workload default_workload() {
	Workload w;
	w.procs.push_back({ 1, 0, 3, -1, 1 });
	w.procs.push_back({ 2, 0, 4, 2, 1 });
	return w;
}

inline std::vector<int> parse_int_list(const std::string& s) {
	std::vector<int> out;
	std::string tok;
	std::stringstream ss(s);
	while (std::getline(ss, tok, ',')) {
		if (!tok.empty()) out.push_back(std::stoi(tok));
	}
	return out;
}

// Parses the plain-text workload format. Lines:
//   # comment
//   name   <text>
//   quanta <q0> <q1> <q2>
//   boost  <every-n-ticks>
//   <pid> <arrival> <burst> [io_every] [io_duration]
inline bool parse_workload(std::istream& in, Workload& w, std::string& err) {
	std::string line;
	int lineno = 0;
	w.procs.clear();
	while (std::getline(in, line)) {
		lineno++;
		auto hash = line.find('#');
		if (hash != std::string::npos) line = line.substr(0, hash);
		std::stringstream ss(line);
		std::string first;
		if (!(ss >> first)) continue;

		if (first == "name") {
			std::string rest;
			std::getline(ss, rest);
			rest.erase(0, rest.find_first_not_of(" \t"));
			rest.erase(rest.find_last_not_of(" \t\r") + 1);
			w.name = rest;
		} else if (first == "quanta") {
			std::vector<int> q;
			int v;
			while (ss >> v) q.push_back(v);
			if (q.empty() || std::any_of(q.begin(), q.end(), [](int x) { return x < 1; })) {
				err = "line " + std::to_string(lineno) + ": quanta must be positive integers";
				return false;
			}
			w.quanta = q;
		} else if (first == "boost") {
			if (!(ss >> w.boost) || w.boost < 0) {
				err = "line " + std::to_string(lineno) + ": boost must be >= 0";
				return false;
			}
		} else {
			ProcessSpec p;
			try { p.pid = std::stoi(first); }
			catch (...) {
				err = "line " + std::to_string(lineno) + ": unknown directive '" + first + "'";
				return false;
			}
			if (!(ss >> p.arrival >> p.burst)) {
				err = "line " + std::to_string(lineno) + ": expected 'pid arrival burst [io_every] [io_duration]'";
				return false;
			}
			ss >> p.io_every >> p.io_duration;
			if (p.io_every <= 0) p.io_every = -1;
			if (p.io_duration < 1) p.io_duration = 1;
			if (p.pid < 1 || p.arrival < 0 || p.burst < 1) {
				err = "line " + std::to_string(lineno) + ": need pid >= 1, arrival >= 0, burst >= 1";
				return false;
			}
			w.procs.push_back(p);
		}
	}
	std::set<int> seen;
	for (auto& p : w.procs) {
		if (!seen.insert(p.pid).second) {
			err = "duplicate pid " + std::to_string(p.pid);
			return false;
		}
	}
	if (w.procs.empty()) {
		err = "workload has no processes";
		return false;
	}
	std::sort(w.procs.begin(), w.procs.end(),
		[](const ProcessSpec& a, const ProcessSpec& b) { return a.pid < b.pid; });
	return true;
}

inline bool load_workload(const std::string& path, Workload& w, std::string& err) {
	std::ifstream f(path);
	if (!f) {
		err = "cannot open " + path;
		return false;
	}
	return parse_workload(f, w, err);
}
