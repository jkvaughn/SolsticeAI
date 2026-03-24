<div className="squircle-lg backdrop-blur-xl p-3 border border-white/20 dark:border-white/10 shadow-2xl overflow-visible">
              {/* Compact Single-Row Layout */}
              <div className="flex items-center justify-between gap-4">
                {/* Left: Title + View Toggle */}
                <div className="flex items-center gap-4">
                  <div>
                    <h1 className="dashboard-text text-xl font-medium">Supply Chain Visualization</h1>
                    <p className="dashboard-text-muted text-xs">DoD to nth-tier suppliers</p>
                  </div>
                  
                  {/* View Mode Toggle - Inline */}
                  <div className="flex items-center gap-1.5 ml-2">
                    <button
                      onClick={() => setViewMode('network')}
                      className={`flex items-center px-2.5 py-1 text-xs rounded-md transition-colors ${
                        viewMode === 'network'
                          ? 'bg-transparent text-emerald-700 dark:text-emerald-400'
                          : 'bg-transparent dashboard-text-muted hover:text-coda-text'
                      }`}
                    >
                      <Network className="size-3" />
                      <span className="font-medium">Network</span>
                    </button>
                    <button
                      onClick={() => setViewMode('tree')}
                      className={`flex items-center px-2.5 py-1 text-xs rounded-md transition-colors ${
                        viewMode === 'tree'
                          ? 'bg-transparent text-emerald-700 dark:text-emerald-400'
                          : 'bg-transparent dashboard-text-muted hover:text-coda-text'
                      }`}
                    >
                      <GitBranch className="size-3" />
                      <span className="font-medium">Tree</span>
                    </button>
                    <button
                      onClick={() => setViewMode('geographic')}
                      className={`flex items-center px-2.5 py-1 text-xs rounded-md transition-colors ${
                        viewMode === 'geographic'
                          ? 'bg-transparent text-emerald-700 dark:text-emerald-400'
                          : 'bg-transparent dashboard-text-muted hover:text-coda-text'
                      }`}
                    >
                      <Map className="size-3" />
                      <span className="font-medium">Geographic</span>
                    </button>
                  </div>
                </div>

                {/* Center: Stats - Context-aware based on view mode - Simplified when Impact Panel visible */}
                <div className="flex items-center gap-2 flex-wrap">
                  {viewMode === 'geographic' ? (
                    // Geographic mode: Show program selector + map stats
                    <>
                      {/* Program Selector */}
                      <div className="relative">
                        <button
                          onClick={() => setShowProgramDropdown(!showProgramDropdown)}
                          className="flex items-center px-2.5 py-1.5 bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer rounded-md"
                        >
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{
                              background: selectedProgramData.color,
                              boxShadow: `0 0 8px ${selectedProgramData.color}`
                            }}
                          />
                          <span className="dashboard-text text-xs font-medium">
                            {selectedProgramData.name}
                          </span>
                          <ChevronDown size={12} className={`dashboard-text-muted transition-transform ${showProgramDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showProgramDropdown && (
                          <div className="absolute top-full left-0 mt-2 min-w-[240px] squircle-lg backdrop-blur-xl bg-white/90 dark:bg-black/90 border border-white/20 dark:border-white/10 shadow-2xl p-2 z-50">
                            {(PROGRAMS || []).map(program => (
                              <button
                                key={program.id}
                                onClick={() => {
                                  setSelectedProgram(program.id);
                                  setShowProgramDropdown(false);
                                }}
                                className={`w-full flex items-center px-3 py-2 text-xs rounded-md transition-colors ${
                                  selectedProgram === program.id
                                    ? 'bg-transparent text-emerald-700 dark:text-emerald-400'
                                    : 'bg-transparent dashboard-text hover:text-coda-text'
                                }`}
                              >
                                <div 
                                  className="w-2 h-2 rounded-full"
                                  style={{ 
                                    background: program.color,
                                    boxShadow: `0 0 8px ${program.color}`
                                  }}
                                />
                                <span className="font-medium">{program.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Map Stats - Show fewer when Impact Panel is visible */}
                      {!impactPanelVisible ? (
                        <>
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-white/20 dark:border-white/10">
                            <span className="dashboard-text-muted text-xs">Suppliers:</span>
                            <span className="dashboard-text text-sm font-medium">{mapStats.totalSuppliers}</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-red-500/20 dark:border-red-500/20">
                            <span className="dashboard-text-muted text-xs">Single Source:</span>
                            <span className="text-sm font-medium text-red-600 dark:text-red-400">{mapStats.singleSource}</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-orange-500/20 dark:border-orange-500/20">
                            <span className="dashboard-text-muted text-xs">High Risk:</span>
                            <span className="text-sm font-medium text-orange-600 dark:text-orange-400">{mapStats.highRisk}</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-white/20 dark:border-white/10">
                            <span className="dashboard-text-muted text-xs">Value:</span>
                            <span className="dashboard-text text-sm font-medium">{formatValue(mapStats.totalValue)}</span>
                          </div>
                        </>
                      ) : (
                        // Simplified stats when Impact Panel visible
                        <>
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-red-500/20 dark:border-red-500/20">
                            <span className="text-xs font-medium text-red-600 dark:text-red-400">{mapStats.singleSource} SS</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-orange-500/20 dark:border-orange-500/20">
                            <span className="text-xs font-medium text-orange-600 dark:text-orange-400">{mapStats.highRisk} Risk</span>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    // Network/Tree mode: Show contractor hierarchy stats
                    <>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-white/20 dark:border-white/10">
                        <span className="dashboard-text-muted text-xs">Entities:</span>
                        <span className="dashboard-text text-sm font-medium">{loading ? '...' : totalEntities}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-emerald-500/20 dark:border-emerald-500/20">
                        <span className="dashboard-text-muted text-xs">Max Depth:</span>
                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{loading ? '...' : maxDepth}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-white/20 dark:border-white/10">
                        <span className="dashboard-text-muted text-xs">Value:</span>
                        <span className="dashboard-text text-sm font-medium">{loading ? '...' : formatValue(totalValue)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 squircle bg-white/40 dark:bg-black/30 border border-orange-500/20 dark:border-orange-500/20">
                        <span className="dashboard-text-muted text-xs">High Risk:</span>
                        <span className="text-sm font-medium text-orange-600 dark:text-orange-400">{loading ? '...' : highRiskCount}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Right: Tier legend for geographic mode only */}
                {viewMode === 'geographic' ? (
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setShowLegend(!showLegend)}
                      className="flex items-center px-2.5 py-1.5 bg-transparent hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors cursor-pointer rounded-md"
                    >
                      <Layers size={14} className="dashboard-text" />
                      <span className="dashboard-text text-xs font-medium">Tiers</span>
                      <ChevronDown size={12} className={`dashboard-text-muted transition-transform ${showLegend ? 'rotate-180' : ''}`} />
                    </button>

                    {showLegend && (
                      <div className="absolute top-full right-0 mt-2 min-w-[200px] squircle-lg backdrop-blur-xl bg-white/90 dark:bg-black/90 border border-white/20 dark:border-white/10 shadow-2xl p-3 z-50">
                        <div className="space-y-2">
                          <div className="text-xs font-bold dashboard-text-muted uppercase tracking-wider mb-2">Supplier Tiers</div>
                          {[
                            { name: 'DoD Facility', color: '#ffffff' },
                            { name: 'Prime Contractor', color: '#10b981' },
                            { name: 'Sub-tier 1', color: '#3b82f6' },
                            { name: 'Sub-tier 2', color: '#8b5cf6' },
                          ].map((tier, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full border-2 border-gray-800 dark:border-gray-600"
                                style={{ background: tier.color }}
                              />
                              <span className="text-xs dashboard-text">{tier.name}</span>
                            </div>
                          ))}
                          <div className="pt-2 mt-2 border-t border-white/20 dark:border-white/10">
                            <div className="text-xs font-bold dashboard-text-muted uppercase tracking-wider mb-2">Arc Status</div>
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-0.5 bg-green-500 rounded" />
                                <span className="text-xs dashboard-text-muted">Healthy</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-0.5 bg-amber-500 rounded" />
                                <span className="text-xs dashboard-text-muted">Strained</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-0.5 bg-red-500 rounded" />
                                <span className="text-xs dashboard-text-muted">At Risk</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // Network/Tree mode: Inline tier legend
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3 h-3 text-[#FFB3B3]" />
                      <span className="dashboard-text-muted text-xs">DoD</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Building2 className="w-3 h-3 text-[#FFB3B3]" />
                      <span className="dashboard-text-muted text-xs">Prime</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3 h-3 text-[#A8DADC]" />
                      <span className="dashboard-text-muted text-xs">Sub</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <User className="w-3 h-3 text-[#B8DDB8]" />
                      <span className="dashboard-text-muted text-xs">Vendor</span>
                    </div>
                  </div>
                )}
              </div>
            </div>