#pragma once
#include "Constants.h"

enum class PROCESS_STATE {
	NEW, READY, RUNNING, BLOCKED, TERMINATED
};

class Process
{
private:
	int pid_;
	PROCESS_STATE state_;
	int remaining_ticks_;

	int priority_level_;

public:
	Process() : 
		pid_(-1), state_(PROCESS_STATE::NEW), 
		remaining_ticks_(-1), priority_level_(0),
		io_block_every_(2), cpu_ticks_used_(0)
	{}
	Process(int pid, int remaining_ticks, int io_block_every) : pid_(pid), 
		state_(PROCESS_STATE::NEW), remaining_ticks_(remaining_ticks), 
		priority_level_(0), io_block_every_(io_block_every), cpu_ticks_used_(0)
	{}

	int pid() { return pid_; }
	void setState(PROCESS_STATE state) { state_ = state; }
	int io_block_every_;
	int cpu_ticks_used_;
	PROCESS_STATE state() { return state_; }
	void tick() {
		remaining_ticks_--;
	}
	int ticks() { return remaining_ticks_; }
	int level() { return priority_level_; }
	void demote_level() {
		if (priority_level_ < LEVELS - 1)
			priority_level_++;
	}
	void promote_level() {
		if (priority_level_ > 0)
			priority_level_--;
	}
};

