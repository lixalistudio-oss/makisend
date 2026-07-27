import { beforeEach,vi } from "vitest";


beforeEach(()=>
{
 vi.clearAllMocks; // Line used to clear all possible instances of mocks before the new test arrving
 vi.resetAllMocks; // Line used to reset to 0 all return parameters set from previous state 
});