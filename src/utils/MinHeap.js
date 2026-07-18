export class MinHeap {
  constructor() { this.heap = [] }
  push(item) { this.heap.push(item); this._bubbleUp(this.heap.length - 1) }
  pop() {
    const top = this.heap[0]
    const last = this.heap.pop()
    if (this.heap.length > 0) { this.heap[0] = last; this._sinkDown(0) }
    return top
  }
  get size() { return this.heap.length }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i-1) >> 1
      if (this.heap[p].f <= this.heap[i].f) break
      ;[this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]]; i = p
    }
  }
  _sinkDown(i) {
    const n = this.heap.length
    while (true) {
      let min = i, l = 2*i+1, r = 2*i+2
      if (l < n && this.heap[l].f < this.heap[min].f) min = l
      if (r < n && this.heap[r].f < this.heap[min].f) min = r
      if (min === i) break
      ;[this.heap[min], this.heap[i]] = [this.heap[i], this.heap[min]]; i = min
    }
  }
}
