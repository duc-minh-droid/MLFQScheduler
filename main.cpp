#include <iostream>
#include "Scheduler.h"
#include "Process.h"
#include "CPU.h"
#include <memory>
#include <map>

int main()
{
    std::map<int, Process> process_table;
    Process process1(1, 3, -1);
    process_table.insert({1, process1});
    Process process2(2, 4, 2);
    process_table.insert({ 2, process2 });

    Scheduler scheduler(process_table);
    CPU cpu(process_table);

    scheduler.enqueue(process1.pid());
    scheduler.enqueue(process2.pid());

    for (int i = 0; i < 5; i++) {
        std::cout << "--- GLOBAL TICK " << i << " ---\n";
        scheduler.io_tick();

        if (cpu.state() == CPU_STATE::IDLE && !scheduler.empty()) {
            int pid = scheduler.schedule();
            int q = scheduler.quantum_for_level(process_table[pid].level());
            cpu.assign(pid, q);
        }

        auto result = cpu.tick();
        scheduler.handle_event(cpu.current_pid(), result);
    }
    
    return 0;
}
