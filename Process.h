#pragma once
#include "Constants.h"

enum class PROCESS_STATE {
	NEW, READY, RUNNING, BLOCKED, TERMINATED
};

inline const char* state_name(PROCESS_STATE s) {
	switch (s) {
		case PROCESS_STATE::NEW: return "new";
		case PROCESS_STATE::READY: return "ready";
		case PROCESS_STATE::RUNNING: return "running";
		case PROCESS_STATE::BLOCKED: return "blocked";
		case PROCESS_STATE::TERMINATED: return "terminated";
	}
	return "?";
}

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
		io_block_every_(-1), cpu_ticks_used_(0)
	{}
	Process(int pid, int remaining_ticks, int io_block_every,
		int arrival = 0, int io_duration = 1) : pid_(pid), 
		state_(PROCESS_STATE::NEW), remaining_ticks_(remaining_ticks), 
		priority_level_(0), io_block_every_(io_block_every), cpu_ticks_used_(0),
		arrival_(arrival), burst_(remaining_ticks), io_duration_(io_duration)
	{
		// 0 and -1 both mean "never blocks on I/O"
		if (io_block_every_ <= 0) io_block_every_ = -1;
		if (io_duration_ < 1) io_duration_ = 1;
	}

	int pid() { return pid_; }
	void setState(PROCESS_STATE state) { state_ = state; }
	int io_block_every_;
	int cpu_ticks_used_;

	// workload description
	int arrival_ = 0;
	int burst_ = 0;
	int io_duration_ = 1;

	// runtime bookkeeping
	int io_remaining_ = 0;  // ticks of I/O left while at the head of the blocked queue
	int first_run_ = -1;    // tick of first dispatch (for response time)
	int finish_ = -1;       // tick at which the process terminated
	int wait_ticks_ = 0;    // ticks spent sitting in a ready queue

	PROCESS_STATE state() { return state_; }
	void tick() {
		remaining_ticks_--;
	}
	int ticks() { return remaining_ticks_; }
	int level() { return priority_level_; }
	void set_level(int level) { priority_level_ = level; }
	void demote_level() {
		if (priority_level_ < LEVELS - 1)
			priority_level_++;
	}
	void promote_level() {
		if (priority_level_ > 0)
			priority_level_--;
	}
};
