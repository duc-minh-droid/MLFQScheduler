#pragma once
#include <vector>
#include <queue>
#include "Process.h"
#include "CPU.h"
#include <memory>
#include "Constants.h"

class Scheduler
{
	using ProcessTable = std::map<int, Process>;
private:
	std::vector<std::queue<int>> ready_queue_;
	std::queue<int> blocked_;
	ProcessTable& ptable_;

public:
	Scheduler(ProcessTable& ptable) : ptable_(ptable) {
		ready_queue_.resize(LEVELS);
	}
	void enqueue(int pid) {
		auto& p = ptable_[pid];
			if (p.state() == PROCESS_STATE::NEW || 
				p.state() == PROCESS_STATE::READY)
			{
				ready_queue_[p.level()].push(pid);
				p.setState(PROCESS_STATE::READY);
			}
		}

	int schedule() {
		for (auto& queue : ready_queue_) {
			if (!queue.empty()) {
				int pid = queue.front();
				queue.pop();
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
				p.demote_level();
				enqueue(pid);
				break;
			}
			case TickResult::BLOCKED: {
				p.promote_level();
				blocked_.push(pid);
				break;
			}
			default:
				break;
		}
	}

	void io_tick() {
		if (!blocked_.empty()) {
			int pid = blocked_.front(); blocked_.pop();
			ptable_[pid].setState(PROCESS_STATE::READY);
			enqueue(pid);
		}
	}

	int quantum_for_level(int level) const {
		static std::vector<int> quanta = { 1, 2, 4 };
		return quanta[std::min(level, (int)quanta.size() - 1)];
	}

};

