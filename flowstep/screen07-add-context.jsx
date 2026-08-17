<!-- screenType: "mobile_ios" width: "402" height: "874" -->
<div className="bg-white text-neutral-950 w-full h-fit">
  <div className="bg-[#F8F4F1] flex flex-col w-100.5 h-218.5 overflow-hidden">
    <div className="overflow-y-auto flex-1">
      <div className="flex px-5 pt-4 pb-1 items-center gap-4">
        <button className="-ml-1 p-1" aria-label="Back">
          <ChevronLeft className="size-6 text-[#2B2426]" />
        </button>
      </div>
      <div className="px-5 pb-3">
        <h1 className="font-serif text-[#2B2426] text-[32px] leading-[37px]">
          Add context
        </h1>
        <p className="uppercase text-[#8A7E7A] text-xs tracking-wider mt-1">
          New moisturiser
        </p>
      </div>
      <div className="border-[#E8DDDA] border-t-0 border-r-0 border-b-1 border-l-0 border-solid px-5 pb-3">
        <p className="font-medium text-[#2B2426] text-base leading-6 mb-2">
          What products did you use since your last check-in?
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            aria-pressed="true"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#F7E6E8] text-[#2B2426] text-sm leading-5 border-[#B9576E] border-1 border-solid px-3 py-1.5"
          >
            Ceramide moisturiser
            <X className="size-3.5 text-[#963D55]" />
          </button>
          <button
            aria-pressed="true"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#F7E6E8] text-[#2B2426] text-sm leading-5 border-[#B9576E] border-1 border-solid px-3 py-1.5"
          >
            Gentle cleanser
            <X className="size-3.5 text-[#963D55]" />
          </button>
          <button
            aria-pressed="false"
            className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5"
          >
            Niacinamide serum
          </button>
          <button
            aria-pressed="false"
            className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5"
          >
            SPF 50
          </button>
          <button className="inline-flex items-center rounded-full bg-transparent text-[#8A7E7A] text-sm leading-5 border-[#C9BDB8] border-1 border-dashed px-3 py-1.5">
            + Add product
          </button>
        </div>
      </div>
      <div className="border-[#E8DDDA] border-t-0 border-r-0 border-b-1 border-l-0 border-solid px-5 py-3">
        <p className="font-medium text-[#2B2426] text-base leading-6 mb-2">
          What did you notice?
        </p>
        <Textarea
          className="min-h-[56px] resize-none rounded-2xl bg-[#FFFDFB] text-[#2B2426] text-base leading-6 border-[#E8DDDA] border-1 border-solid p-3 h-11"
          defaultValue="Less tightness after cleansing, still dry along the jaw."
        />
      </div>
      <div className="border-[#E8DDDA] border-t-0 border-r-0 border-b-1 border-l-0 border-solid px-5 py-3">
        <p className="font-medium text-[#2B2426] text-base leading-6 mb-2">
          Anything that may affect comparison?
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5">
            Sleep
          </button>
          <button className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5">
            Stress
          </button>
          <button
            aria-pressed="true"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#F7E6E8] text-[#2B2426] text-sm leading-5 border-[#B9576E] border-1 border-solid px-3 py-1.5"
          >
            Travel
            <X className="size-3.5 text-[#963D55]" />
          </button>
          <button className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5">
            Weather
          </button>
          <button className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5">
            Cycle
          </button>
          <button className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5">
            Makeup
          </button>
          <button className="inline-flex items-center rounded-full bg-[#FFFDFB] text-[#2B2426] text-sm leading-5 border-[#E8DDDA] border-1 border-solid px-3 py-1.5">
            Other
          </button>
        </div>
      </div>
      <div className="px-5 py-3">
        <p className="font-medium text-[#2B2426] text-base leading-6 mb-2">
          Capture conditions
        </p>
        <Tabs defaultValue="Mixed">
          <TabsList className="rounded-full bg-[#F0E9E6] p-1 w-full h-11">
            <TabsTrigger
              value="Daylight"
              className="rounded-full text-sm leading-5 flex-1"
            >
              Daylight
            </TabsTrigger>
            <TabsTrigger
              value="Indoor"
              className="rounded-full text-sm leading-5 flex-1"
            >
              Indoor
            </TabsTrigger>
            <TabsTrigger
              value="Mixed"
              className="rounded-full text-sm leading-5 flex-1"
            >
              Mixed
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex mt-3 items-center gap-3">
          <Checkbox
            className="size-5 rounded-md border-[#C9BDB8] border-1 border-solid"
            defaultChecked={false}
          />
          <p className="text-[#2B2426] text-base leading-6">
            Same place and framing as my baseline.
          </p>
        </div>
      </div>
      <div className="h-2" />
    </div>
    <div className="bg-[#F8F4F1] border-[#E8DDDA] border-t-1 border-r-0 border-b-0 border-l-0 border-solid flex px-5 pt-4 pb-6 flex-col gap-3">
      <Button className="font-medium rounded-xl bg-[#B9576E] text-[#FFFDFB] text-base w-full h-12 hover:bg-[#963D55]">
        Continue to consent
      </Button>
      <button className="font-medium text-center text-[#2B2426] text-[15px] py-1 w-full">
        Save as draft
      </button>
    </div>
  </div>
</div>
