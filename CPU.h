#pragma once
#include "Process.h"
#include <memory>
#include <iostream>
#include <map>

enum class CPU_STATE {
	IDLE, RUNNING
};

enum class TickResult {
	NONE, TERMINATED, PREEMPTED, BLOCKED
};

class CPU
{
	using ProcessTable = std::map<int, Process>;
private:
	ProcessTable& ptable_;
	CPU_STATE state_;
	int current_pid_;
	int quantum_;
	int ticks_used_;

public:
	CPU(ProcessTable& ptable) : 
		ptable_(ptable), state_(CPU_STATE::IDLE), 
		current_pid_(0), ticks_used_(0), quantum_(2) {}

	TickResult tick() {
		if (state_ == CPU_STATE::IDLE) return TickResult::NONE;
		auto& current_process = ptable_[current_pid_];

		// process current process
		current_process.tick();
		ticks_used_++;

		std::cout << "Processing process with id " << current_pid_ << std::endl;
		std::cout << "Remaining ticks: " << current_process.ticks() << std::endl;
		
		if (current_process.io_block_every_ != -1) {
			current_process.cpu_ticks_used_++;
			if (current_process.cpu_ticks_used_ == current_process.io_block_every_) {
				current_process.cpu_ticks_used_ = 0;
				current_process.setState(PROCESS_STATE::BLOCKED);
				state_ = CPU_STATE::IDLE;
				return TickResult::BLOCKED;
			}
		}

		if (current_process.ticks() == 0) {
			current_process.setState(PROCESS_STATE::TERMINATED);
			state_ = CPU_STATE::IDLE;
			std::cout << "Process " << current_pid_ << " terminated\n";
			return TickResult::TERMINATED;
		}

		if (ticks_used_ == quantum_) {
			// preempt: stop and switch
			current_process.setState(PROCESS_STATE::READY);
			state_ = CPU_STATE::IDLE;

			return TickResult::PREEMPTED;
		}

		return TickResult::NONE;
	}

	void assign(int pid, int quantum) {
		current_pid_ = pid;
		quantum_ = quantum;
		state_ = CPU_STATE::RUNNING;
		ptable_[pid].setState(PROCESS_STATE::RUNNING);
		ticks_used_ = 0;
	}
	CPU_STATE state() { return state_; }
	int current_pid() { return current_pid_; }
};

