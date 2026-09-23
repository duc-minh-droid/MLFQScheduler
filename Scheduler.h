#pragma once
#include <vector>
#include <deque>
#include <map>
#include <algorithm>
#include "Process.h"
#include "CPU.h"
#include <memory>
#include "Constants.h"

class Scheduler
{
	using ProcessTable = std::map<int, Process>;
private:
	// deques instead of std::queue so the trace writer can look inside them
	std::vector<std::deque<int>> ready_queue_;
	std::deque<int> blocked_;
	ProcessTable& ptable_;
	std::vector<int> quanta_;

public:
	Scheduler(ProcessTable& ptable, std::vector<int> quanta = { 1, 2, 4 })
		: ptable_(ptable), quanta_(quanta) {
		ready_queue_.resize(LEVELS);
		if (quanta_.empty()) quanta_ = { 1, 2, 4 };
	}
	void enqueue(int pid) {
		auto& p = ptable_[pid];
		if (p.state() == PROCESS_STATE::NEW || 
			p.state() == PROCESS_STATE::READY)
		{
			ready_queue_[p.level()].push_back(pid);
			p.setState(PROCESS_STATE::READY);
		}
	}

	int schedule() {
		for (auto& queue : ready_queue_) {
			if (!queue.empty()) {
				int pid = queue.front();
				queue.pop_front();
				return pid;
			}
		}
		return -1;
	}

	bool empty() {
		for (const auto& queue : ready_queue_) {
			if (!queue.empty()) {
				return false;
			}
		}
		return true;
	}

	void handle_event(int pid, TickResult result) {
		auto& p = ptable_[pid];
		switch (result) {
			case TickResult::PREEMPTED: {
				// used its whole quantum: looks CPU-bound, push it down
				p.demote_level();
				enqueue(pid);
				break;
			}
			case TickResult::BLOCKED: {
				// gave up the CPU for I/O: looks interactive, pull it up
				p.promote_level();
				p.io_remaining_ = p.io_duration_;
				blocked_.push_back(pid);
				break;
			}
			default:
				break;
		}
	}

	// One I/O device serves the blocked queue in FIFO order. Each global tick
	// the process at the head gets one tick of I/O; when its I/O is done it
	// goes back to the ready queue of its (possibly promoted) level.
	// Returns the pid that finished I/O this tick, or -1.
	int io_tick() {
		if (blocked_.empty()) return -1;
		int pid = blocked_.front();
		auto& p = ptable_[pid];
		if (--p.io_remaining_ > 0) return -1;
		blocked_.pop_front();
		p.setState(PROCESS_STATE::READY);
		enqueue(pid);
		return pid;
	}

	// Priority boost (MLFQ rule 5): every process goes back to the top level so
	// CPU-bound jobs that sank to the bottom cannot starve. Queue order is kept:
	// level 0 first, then what was in level 1, then level 2.
	void boost() {
		for (auto& [pid, p] : ptable_) {
			if (p.state() != PROCESS_STATE::TERMINATED) p.set_level(0);
		}
		for (int l = 1; l < LEVELS; l++) {
			for (int pid : ready_queue_[l]) ready_queue_[0].push_back(pid);
			ready_queue_[l].clear();
		}
	}

	int quantum_for_level(int level) const {
		return quanta_[std::min(level, (int)quanta_.size() - 1)];
	}

	const std::vector<std::deque<int>>& ready_queues() const { return ready_queue_; }
	const std::deque<int>& blocked() const { return blocked_; }
	const std::vector<int>& quanta() const { return quanta_; }
};
